import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";
import { processWithConcurrency } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = "llava:13b";
const BATCH_SIZE = 20;
const CONCURRENCY = 1; // Serial — Ollama uses all GPU for one inference
const MAX_RETRIES = 2;

/** Extensions browsers (and LLaVA) can handle natively as images */
const WEB_NATIVE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
]);

// ── Ollama health ──────────────────────────────────────────────

export interface OllamaHealth {
  running: boolean;
  model_loaded: boolean;
}

export async function checkOllamaHealth(): Promise<OllamaHealth> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return { running: false, model_loaded: false };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    const loaded = models.some(
      (m) => m.name === MODEL || m.name.startsWith(MODEL.split(":")[0])
    );
    return { running: true, model_loaded: loaded };
  } catch {
    return { running: false, model_loaded: false };
  }
}

// ── Single image analysis ──────────────────────────────────────

export interface LlavaResult {
  description: string;
  tags: string[];
}

const PROMPT = `Analyze this image. Respond with ONLY a JSON object in this exact format, nothing else:
{"description": "A detailed 1-2 sentence description of the image", "tags": ["tag1", "tag2", "tag3"]}

Include 5-10 descriptive tags covering: subjects, setting, colors, mood, activities, objects.`;

export async function analyzeImage(imagePath: string): Promise<LlavaResult> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: PROMPT,
          images: [base64Image],
          stream: false,
          options: { temperature: 0.1 },
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.status}`);
      }

      const data = (await res.json()) as { response: string };
      return parseResponse(data.response);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        console.warn(
          `LLaVA attempt ${attempt + 1} failed for ${imagePath}: ${lastError.message}. Retrying...`
        );
      }
    }
  }
  throw lastError!;
}

/** Parse LLaVA response, with regex fallback for malformed JSON */
function parseResponse(raw: string): LlavaResult {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(raw.trim());
    return validateResult(parsed);
  } catch {
    // noop, try regex extraction
  }

  // Try extracting JSON from markdown code blocks or surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*?"description"[\s\S]*?"tags"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateResult(parsed);
    } catch {
      // noop
    }
  }

  // Last resort: extract what we can
  const descMatch = raw.match(/"description"\s*:\s*"([^"]+)"/);
  const tagsMatch = raw.match(/"tags"\s*:\s*\[([\s\S]*?)\]/);
  if (descMatch) {
    const tags: string[] = [];
    if (tagsMatch) {
      const tagStr = tagsMatch[1];
      for (const m of tagStr.matchAll(/"([^"]+)"/g)) {
        tags.push(m[1]);
      }
    }
    return { description: descMatch[1], tags };
  }

  throw new Error(`Failed to parse LLaVA response: ${raw.substring(0, 200)}`);
}

function validateResult(obj: unknown): LlavaResult {
  const o = obj as Record<string, unknown>;
  if (typeof o.description !== "string" || !Array.isArray(o.tags)) {
    throw new Error("Invalid LLaVA result shape");
  }
  return {
    description: o.description,
    tags: o.tags.filter((t): t is string => typeof t === "string"),
  };
}

// ── Image path resolution ──────────────────────────────────────

interface MediaRow {
  id: number;
  type: "video" | "photo";
  absolute_path: string;
  file_ext: string;
  ai_state: string;
}

/**
 * Resolve the image to send to LLaVA:
 * - Videos: poster-frame thumbnail (requires ai_state='done')
 * - Photos with web-native extensions: original file
 * - RAW photos: cached thumbnail JPEG
 * Returns null if no suitable image is available.
 */
export function getImagePath(item: MediaRow): string | null {
  if (item.type === "video") {
    // Use poster-frame thumbnail
    if (item.ai_state !== "done") return null;
    const posterPath = path.join(THUMBNAILS_DIR, `${item.id}.jpg`);
    return fs.existsSync(posterPath) ? posterPath : null;
  }

  // Photo
  const ext = item.file_ext.toLowerCase();
  if (WEB_NATIVE_EXTS.has(ext)) {
    return fs.existsSync(item.absolute_path) ? item.absolute_path : null;
  }

  // RAW: check for cached thumbnail
  const cachedPath = path.join(THUMBNAILS_DIR, `photo-${item.id}.jpg`);
  return fs.existsSync(cachedPath) ? cachedPath : null;
}

// ── Batch analysis ─────────────────────────────────────────────

export interface AnalyzeResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export async function analyzeBatch(volume?: string): Promise<AnalyzeResult> {
  const db = getDb();

  // Pick items that are not_started or queued AND have an available image
  const volumeClause = volume ? " AND m.volume_name = ?" : "";
  const baseParams: string[] = volume ? [volume] : [];

  // We need to find items with llava_state in (not_started, queued) that have images available.
  // For videos: ai_state must be 'done' (poster frame exists)
  // For photos: availability must be 'online'
  const items = db
    .prepare(
      `SELECT m.id, m.type, m.absolute_path, m.file_ext, m.ai_state
       FROM media_items m
       WHERE m.availability = 'online'
         AND m.llava_state IN ('not_started', 'queued')${volumeClause}
       LIMIT ?`
    )
    .all(...baseParams, BATCH_SIZE) as MediaRow[];

  // Filter to items that actually have an image path
  const analyzable = items.filter((item) => getImagePath(item) !== null);

  if (analyzable.length === 0) {
    const remaining = countRemaining(volume);
    return { processed: 0, succeeded: 0, failed: 0, remaining };
  }

  // Mark batch as queued
  const markQueued = db.prepare(
    "UPDATE media_items SET llava_state = 'queued' WHERE id = ?"
  );
  db.transaction(() => {
    for (const item of analyzable) markQueued.run(item.id);
  })();

  const markDone = db.prepare(
    "UPDATE media_items SET llava_state = 'done' WHERE id = ?"
  );
  const markError = db.prepare(
    "UPDATE media_items SET llava_state = 'error' WHERE id = ?"
  );
  const insertArtifact = db.prepare(
    `INSERT INTO ai_artifacts (media_item_id, kind, json) VALUES (?, 'llava_analysis', ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO media_fts (rowid, description, tags) VALUES (?, ?, ?)`
  );

  let succeeded = 0;
  let failed = 0;

  await processWithConcurrency(analyzable, CONCURRENCY, async (item) => {
    const imgPath = getImagePath(item)!;
    try {
      const result = await analyzeImage(imgPath);
      const jsonStr = JSON.stringify(result);
      db.transaction(() => {
        // Remove any existing llava_analysis artifact
        db.prepare(
          "DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = 'llava_analysis'"
        ).run(item.id);
        insertArtifact.run(item.id, jsonStr);
        // Remove existing FTS entry if any, then insert
        db.prepare("DELETE FROM media_fts WHERE rowid = ?").run(item.id);
        insertFts.run(item.id, result.description, result.tags.join(", "));
        markDone.run(item.id);
      })();
      succeeded++;
    } catch (err) {
      console.error(
        `LLaVA analysis failed for ${item.absolute_path}: ${(err as Error).message}`
      );
      markError.run(item.id);
      failed++;
    }
  });

  const remaining = countRemaining(volume);
  return { processed: analyzable.length, succeeded, failed, remaining };
}

function countRemaining(volume?: string): number {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE availability = 'online'
         AND llava_state IN ('not_started', 'queued')${volumeClause}`
    )
    .get(...params) as { count: number };
  return row.count;
}

// ── Status ─────────────────────────────────────────────────────

export interface LlavaStatus {
  not_started: number;
  queued: number;
  done: number;
  error: number;
  analyzable: number;
}

export function llavaStatus(volume?: string): LlavaStatus {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];

  const rows = db
    .prepare(
      `SELECT llava_state, COUNT(*) as count FROM media_items
       WHERE availability = 'online'${volumeClause}
       GROUP BY llava_state`
    )
    .all(...params) as { llava_state: string; count: number }[];

  const counts: LlavaStatus = {
    not_started: 0,
    queued: 0,
    done: 0,
    error: 0,
    analyzable: 0,
  };
  for (const row of rows) {
    if (row.llava_state in counts) {
      counts[row.llava_state as keyof Omit<LlavaStatus, "analyzable">] =
        row.count;
    }
  }

  // Count analyzable: items that are not_started AND have an image source
  // Videos with ai_state='done', web-native photos (online), RAW photos with cached thumb
  const analyzableRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE availability = 'online'
         AND llava_state = 'not_started'
         AND (
           (type = 'video' AND ai_state = 'done')
           OR (type = 'photo')
         )${volumeClause}`
    )
    .get(...params) as { count: number };
  counts.analyzable = analyzableRow.count;

  return counts;
}
