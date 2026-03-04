import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getDb } from "../../db/connection.js";
import {
  startStorageScan,
  stopStorageScan,
  getStorageScanStatus,
} from "../../indexer/storage-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../../data/thumbnails");

const router = Router();

/** Build optional WHERE clauses for volume, type, file_ext filters */
function buildFilters(query: Record<string, unknown>): { clauses: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.volume) { clauses.push("volume_name = ?"); params.push(query.volume); }
  if (query.type) { clauses.push("type = ?"); params.push(query.type); }
  if (query.file_ext) { clauses.push("file_ext = ?"); params.push(query.file_ext); }
  return { clauses: clauses.length ? " AND " + clauses.join(" AND ") : "", params };
}

// ── Scan control ────────────────────────────────────────────────

router.post("/storage/scan/start", (_req, res) => {
  const started = startStorageScan();
  if (!started) {
    return res.json({ started: false, message: "Scan already running" });
  }
  res.json({ started: true });
});

router.post("/storage/scan/stop", (_req, res) => {
  const stopped = stopStorageScan();
  res.json({ stopped, ...getStorageScanStatus() });
});

router.get("/storage/scan/status", (_req, res) => {
  res.json(getStorageScanStatus());
});

// ── Duplicates (hamming distance grouping) ──────────────────────

router.get("/storage/duplicates", (req, res) => {
  const threshold = parseInt(req.query.threshold as string) || 10;
  const { clauses, params } = buildFilters(req.query);
  const db = getDb();

  // Get all items with a phash
  const items = db
    .prepare(
      `SELECT id, filename, absolute_path, type, file_ext, size_bytes, phash, ai_state,
              volume_name, mtime_ms, availability, llava_state, llava_version,
              latitude, longitude, location_name
       FROM media_items
       WHERE phash IS NOT NULL AND availability = 'online'${clauses}
       ORDER BY phash`
    )
    .all(...params) as Record<string, unknown>[];

  // Group by hamming distance
  const groups: Record<string, unknown>[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const itemI = items[i] as Record<string, unknown>;
    if (assigned.has(itemI.id as number)) continue;
    const group = [itemI];
    assigned.add(itemI.id as number);

    for (let j = i + 1; j < items.length; j++) {
      const itemJ = items[j] as Record<string, unknown>;
      if (assigned.has(itemJ.id as number)) continue;
      const dist = hammingDistance(itemI.phash as string, itemJ.phash as string);
      if (dist <= threshold) {
        group.push(itemJ);
        assigned.add(itemJ.id as number);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  res.json({ groups });
});

function hammingDistance(a: string, b: string): number {
  const av = BigInt("0x" + a);
  const bv = BigInt("0x" + b);
  let xor = av ^ bv;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

// ── Short videos ────────────────────────────────────────────────

router.get("/storage/short-videos", (req, res) => {
  const maxDuration = parseFloat(req.query.max_duration as string) || 1.5;
  const { clauses, params } = buildFilters(req.query);
  const db = getDb();
  const items = db
    .prepare(
      `SELECT id, filename, absolute_path, type, file_ext, size_bytes, duration_sec, ai_state,
              volume_name, mtime_ms, availability, llava_state, llava_version,
              latitude, longitude, location_name
       FROM media_items
       WHERE type = 'video' AND duration_sec IS NOT NULL AND duration_sec <= ?
         AND availability = 'online'${clauses}
       ORDER BY duration_sec ASC`
    )
    .all(maxDuration, ...params);
  res.json({ items });
});

// ── Blurry media ────────────────────────────────────────────────

router.get("/storage/blurry", (req, res) => {
  const maxBlur = parseFloat(req.query.max_blur as string) || 100;
  const { clauses, params } = buildFilters(req.query);
  const db = getDb();
  const items = db
    .prepare(
      `SELECT id, filename, absolute_path, type, file_ext, size_bytes, blur_score, ai_state,
              volume_name, mtime_ms, availability, llava_state, llava_version,
              latitude, longitude, location_name
       FROM media_items
       WHERE blur_score IS NOT NULL AND blur_score <= ?
         AND availability = 'online'${clauses}
       ORDER BY blur_score ASC`
    )
    .all(maxBlur, ...params);
  res.json({ items });
});

// ── Large files ─────────────────────────────────────────────────

router.get("/storage/large", (req, res) => {
  const minSize = parseInt(req.query.min_size as string) || 500_000_000;
  const limit = parseInt(req.query.limit as string) || 50;
  const { clauses, params } = buildFilters(req.query);
  const db = getDb();
  const items = db
    .prepare(
      `SELECT id, filename, absolute_path, type, file_ext, size_bytes, ai_state,
              volume_name, mtime_ms, availability, llava_state, llava_version,
              latitude, longitude, location_name
       FROM media_items
       WHERE size_bytes >= ? AND availability = 'online'${clauses}
       ORDER BY size_bytes DESC
       LIMIT ?`
    )
    .all(minSize, ...params, limit);
  res.json({ items });
});

// ── Delete (move to macOS Trash) ────────────────────────────────

router.delete("/storage/files", (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array required" });
  }

  const db = getDb();
  let trashed = 0;
  let errors = 0;
  let freedBytes = 0;

  for (const id of ids) {
    const item = db
      .prepare("SELECT id, absolute_path, size_bytes, type, ai_state FROM media_items WHERE id = ?")
      .get(id) as { id: number; absolute_path: string; size_bytes: number; type: string; ai_state: string } | undefined;

    if (!item) continue;

    try {
      // Move to macOS Trash via osascript (reversible)
      if (fs.existsSync(item.absolute_path)) {
        execFileSync("osascript", [
          "-e",
          `tell application "Finder" to delete (POSIX file "${item.absolute_path}" as alias)`,
        ], { timeout: 10_000 });
      }

      // Clean up thumbnail
      if (item.type === "video") {
        const thumb = path.join(THUMBNAILS_DIR, `${item.id}.jpg`);
        if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
      } else {
        const thumb = path.join(THUMBNAILS_DIR, `photo-${item.id}.jpg`);
        if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
      }

      // Remove from DB (CASCADE deletes ai_artifacts)
      db.prepare("DELETE FROM media_items WHERE id = ?").run(item.id);
      freedBytes += item.size_bytes;
      trashed++;
    } catch (err) {
      console.error(`Failed to trash ${item.absolute_path}: ${(err as Error).message}`);
      errors++;
    }
  }

  // Rebuild FTS after deletions
  if (trashed > 0) {
    db.exec(`DROP TABLE IF EXISTS media_fts`);
    db.exec(`CREATE VIRTUAL TABLE media_fts USING fts5(description, tags, filename, location_name, content='', content_rowid='rowid')`);
    db.exec(`
      INSERT INTO media_fts (rowid, description, tags, filename, location_name)
        SELECT m.id,
               COALESCE(json_extract(a.json, '$.description'), ''),
               COALESCE((SELECT GROUP_CONCAT(value, ', ') FROM json_each(a.json, '$.tags')), ''),
               m.filename,
               COALESCE(m.location_name, '')
        FROM media_items m
        LEFT JOIN ai_artifacts a ON a.media_item_id = m.id AND a.kind = 'llava_analysis'
    `);
  }

  res.json({ trashed, errors, freedBytes });
});

export default router;
