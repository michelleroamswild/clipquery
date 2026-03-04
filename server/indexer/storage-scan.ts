import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";
import { processWithConcurrency } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const BATCH_SIZE = 50;
const CONCURRENCY = 4;

// ── Helpers ─────────────────────────────────────────────────────

/** Get video duration in seconds via ffprobe */
function getDuration(filePath: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { timeout: 15_000 }
    );
    const val = parseFloat(out.toString().trim());
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/** Compute blur score (Laplacian variance) from a thumbnail JPEG */
function getBlurScore(imagePath: string): number | null {
  try {
    // Apply Laplacian convolution via ffmpeg, output raw grayscale bytes
    const buf = execFileSync(
      "ffmpeg",
      [
        "-i", imagePath,
        "-vf", "format=gray,convolution=0 1 0 1 -4 1 0 1 0:0 0 0 0 0 0 0 0 0",
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "gray",
        "-",
      ],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }
    );

    if (buf.length === 0) return null;

    // Compute variance of pixel values
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i];
      sumSq += buf[i] * buf[i];
    }
    const mean = sum / buf.length;
    const variance = sumSq / buf.length - mean * mean;
    return Math.round(variance * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Compute a 64-bit perceptual difference hash (dHash).
 * Resize to 9×8 grayscale, compare adjacent horizontal pixels.
 * Returns a 16-char hex string.
 */
function getPhash(imagePath: string): string | null {
  try {
    const buf = execFileSync(
      "ffmpeg",
      [
        "-i", imagePath,
        "-vf", "scale=9:8,format=gray",
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "gray",
        "-",
      ],
      { timeout: 15_000, maxBuffer: 1024 }
    );

    if (buf.length !== 72) return null; // 9×8 = 72 bytes

    // Build 64-bit hash: for each row (8 rows), compare 8 adjacent pairs
    let hash = BigInt(0);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 9 + col;
        if (buf[idx] < buf[idx + 1]) {
          hash |= BigInt(1) << BigInt(row * 8 + col);
        }
      }
    }

    return hash.toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

/** Resolve thumbnail/poster path for a media item */
function getThumbnailPath(item: ScanRow): string | null {
  if (item.type === "video") {
    if (item.ai_state !== "done") return null;
    const p = path.join(THUMBNAILS_DIR, `${item.id}.jpg`);
    return fs.existsSync(p) ? p : null;
  }
  // Photo: check for cached thumbnail first, then original for web-native
  const cached = path.join(THUMBNAILS_DIR, `photo-${item.id}.jpg`);
  if (fs.existsSync(cached)) return cached;
  const ext = item.file_ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
    return fs.existsSync(item.absolute_path) ? item.absolute_path : null;
  }
  return null;
}

// ── Types ───────────────────────────────────────────────────────

interface ScanRow {
  id: number;
  type: "video" | "photo";
  absolute_path: string;
  file_ext: string;
  ai_state: string;
}

// ── Batch processing ────────────────────────────────────────────

async function scanBatch(): Promise<{ processed: number; remaining: number }> {
  const db = getDb();

  const items = db
    .prepare(
      `SELECT id, type, absolute_path, file_ext, ai_state
       FROM media_items
       WHERE availability = 'online'
         AND storage_scan_state = 'not_started'
       ORDER BY size_bytes DESC
       LIMIT ?`
    )
    .all(BATCH_SIZE) as ScanRow[];

  if (items.length === 0) {
    const rem = db.prepare(
      `SELECT COUNT(*) as c FROM media_items WHERE availability = 'online' AND storage_scan_state = 'not_started'`
    ).get() as { c: number };
    return { processed: 0, remaining: rem.c };
  }

  // Mark as queued
  const markQueued = db.prepare(
    "UPDATE media_items SET storage_scan_state = 'queued' WHERE id = ?"
  );
  db.transaction(() => {
    for (const item of items) markQueued.run(item.id);
  })();

  const markDone = db.prepare(
    `UPDATE media_items SET storage_scan_state = 'done',
       phash = ?, blur_score = ?, duration_sec = ?
     WHERE id = ?`
  );
  const markError = db.prepare(
    "UPDATE media_items SET storage_scan_state = 'error' WHERE id = ?"
  );

  await processWithConcurrency(items, CONCURRENCY, async (item) => {
    try {
      let duration: number | null = null;
      let blur: number | null = null;
      let phash: string | null = null;

      // Duration: videos only, from original file
      if (item.type === "video" && fs.existsSync(item.absolute_path)) {
        duration = getDuration(item.absolute_path);
      }

      // Blur + phash: from thumbnail
      const thumbPath = getThumbnailPath(item);
      if (thumbPath) {
        blur = getBlurScore(thumbPath);
        phash = getPhash(thumbPath);
      }

      markDone.run(phash, blur, duration, item.id);
    } catch (err) {
      console.error(`Storage scan failed for ${item.absolute_path}: ${(err as Error).message}`);
      markError.run(item.id);
    }
  });

  const rem = db.prepare(
    `SELECT COUNT(*) as c FROM media_items WHERE availability = 'online' AND storage_scan_state = 'not_started'`
  ).get() as { c: number };

  return { processed: items.length, remaining: rem.c };
}

// ── Background worker ───────────────────────────────────────────

interface BackgroundState {
  running: boolean;
  processed: number;
  total: number;
  remaining: number;
  startedAt?: number;
}

const bgState: BackgroundState = {
  running: false,
  processed: 0,
  total: 0,
  remaining: 0,
};

export function getStorageScanStatus(): BackgroundState {
  return { ...bgState };
}

export function startStorageScan(): boolean {
  if (bgState.running) return false;

  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM media_items WHERE availability = 'online' AND storage_scan_state = 'not_started'`
  ).get() as { c: number };

  bgState.running = true;
  bgState.processed = 0;
  bgState.total = row.c;
  bgState.remaining = row.c;
  bgState.startedAt = Date.now();

  (async () => {
    try {
      while (bgState.running) {
        const res = await scanBatch();
        bgState.processed += res.processed;
        bgState.remaining = res.remaining;
        if (res.processed === 0) break;
      }
    } catch (err) {
      console.error("Storage scan error:", (err as Error).message);
    } finally {
      bgState.running = false;
    }
  })();

  return true;
}

export function stopStorageScan(): boolean {
  if (!bgState.running) return false;
  bgState.running = false;
  return true;
}
