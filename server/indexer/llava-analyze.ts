import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import { getDb } from "../db/connection.js";
import { processWithConcurrency } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = "llava:13b";
const BATCH_SIZE = 1;
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
  colors: string[];
}

const PROMPT = `Describe this image in detail. Respond with ONLY a JSON object in this exact format, nothing else:
{"description": "A detailed 2-3 sentence description of everything visible in the image", "tags": ["tag1", "tag2", "tag3"], "colors": ["color1", "color2"]}

Include 8-15 specific tags. Be thorough — tag every visible object (vehicles, animals, buildings, furniture, signs, etc.), people and their actions, the environment/setting, weather, time of day, and mood. Use specific words like "car", "truck", "dog", "mountain" rather than vague terms.

IMPORTANT: Do NOT guess or mention specific place names, cities, countries, landmarks, or locations. Describe only what you can see in the image without identifying where it was taken.

For "colors", list the 3-5 dominant colors in the image using specific names (e.g. "burnt orange", "teal", "golden yellow", "slate gray", "forest green"). Not generic — be precise about the actual hues you see.`;

/** Try to get the capture hour from EXIF DateTimeOriginal */
async function getCaptureHour(originalPath: string): Promise<number | null> {
  try {
    const exif = await exifr.parse(originalPath, ["DateTimeOriginal"]);
    if (exif?.DateTimeOriginal instanceof Date) {
      return exif.DateTimeOriginal.getHours();
    }
  } catch {
    // ignore
  }
  return null;
}

function timeOfDayLabel(hour: number): string {
  if (hour >= 5 && hour < 8) return "early morning (sunrise time)";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening (sunset time)";
  if (hour >= 20 && hour < 22) return "dusk/twilight";
  return "night";
}

export async function analyzeImage(imagePath: string, originalPath?: string): Promise<LlavaResult> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  // Build prompt with time-of-day context if available
  let prompt = PROMPT;
  if (originalPath) {
    const hour = await getCaptureHour(originalPath);
    if (hour != null) {
      prompt += `\n\nMetadata context: This photo was taken during the ${timeOfDayLabel(hour)} (${hour}:00). Use this to correctly distinguish sunrise vs sunset and other time-dependent observations.`;
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
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
    const colors: string[] = [];
    const colorsMatch = raw.match(/"colors"\s*:\s*\[([\s\S]*?)\]/);
    if (colorsMatch) {
      for (const m of colorsMatch[1].matchAll(/"([^"]+)"/g)) {
        colors.push(m[1]);
      }
    }
    return { description: descMatch[1], tags, colors };
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
    colors: Array.isArray(o.colors)
      ? o.colors.filter((c): c is string => typeof c === "string")
      : [],
  };
}

// ── Image path resolution ──────────────────────────────────────

interface MediaRow {
  id: number;
  type: "video" | "photo";
  absolute_path: string;
  filename: string;
  file_ext: string;
  ai_state: string;
  location_name: string | null;
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

  // RAW: check for cached thumbnail, generate if missing
  const cachedPath = path.join(THUMBNAILS_DIR, `photo-${item.id}.jpg`);
  if (fs.existsSync(cachedPath)) return cachedPath;

  // Try to generate a thumbnail for RAW files
  if (fs.existsSync(item.absolute_path)) {
    try {
      return convertRawToJpeg(item.absolute_path, cachedPath);
    } catch {
      return null;
    }
  }
  return null;
}

/** Convert a RAW photo to JPEG thumbnail, trying ffmpeg then exiftool */
function convertRawToJpeg(inputPath: string, outputPath: string): string | null {
  // Ensure thumbnails dir exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    execFileSync("ffmpeg", [
      "-i", inputPath,
      "-vf", "scale=1024:-1",
      "-frames:v", "1",
      "-q:v", "3",
      "-y",
      outputPath,
    ], { timeout: 30_000 });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
  } catch {
    // fallback
  }

  try {
    execFileSync("bash", [
      "-c",
      `exiftool -b -PreviewImage "${inputPath}" > "${outputPath}"`,
    ], { timeout: 30_000 });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
  } catch {
    // both failed
  }

  return null;
}

// ── Batch analysis ─────────────────────────────────────────────

export interface AnalyzeResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export async function analyzeBatch(volume?: string, type?: string): Promise<AnalyzeResult> {
  const db = getDb();

  // Pick items that are not_started or queued AND have an available image
  const volumeClause = volume ? " AND m.volume_name = ?" : "";
  const typeClause = type ? " AND m.type = ?" : "";
  const baseParams: string[] = [];
  if (volume) baseParams.push(volume);
  if (type) baseParams.push(type);

  // Only pick items that have an image available:
  // Videos need ai_state='done' (poster frame exists), photos just need to be online
  const items = db
    .prepare(
      `SELECT m.id, m.type, m.absolute_path, m.filename, m.file_ext, m.ai_state, m.location_name
       FROM media_items m
       WHERE m.availability = 'online'
         AND m.llava_state IN ('not_started', 'queued')
         AND (
           (m.type = 'video' AND m.ai_state = 'done')
           OR m.type = 'photo'
         )${volumeClause}${typeClause}
       ORDER BY m.mtime_ms DESC
       LIMIT ?`
    )
    .all(...baseParams, BATCH_SIZE) as MediaRow[];

  // Verify the image file actually exists on disk
  const analyzable = items.filter((item) => getImagePath(item) !== null);

  if (analyzable.length === 0) {
    const remaining = countRemaining(volume, type);
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
    "UPDATE media_items SET llava_state = 'done', llava_version = 2 WHERE id = ?"
  );
  const markError = db.prepare(
    "UPDATE media_items SET llava_state = 'error' WHERE id = ?"
  );
  const insertArtifact = db.prepare(
    `INSERT INTO ai_artifacts (media_item_id, kind, json) VALUES (?, 'llava_analysis', ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO media_fts (rowid, description, tags, filename, location_name) VALUES (?, ?, ?, ?, ?)`
  );

  let succeeded = 0;
  let failed = 0;

  await processWithConcurrency(analyzable, CONCURRENCY, async (item) => {
    const imgPath = getImagePath(item)!;
    try {
      const result = await analyzeImage(imgPath, item.absolute_path);
      const jsonStr = JSON.stringify({ ...result, version: 2 });
      db.transaction(() => {
        // Remove any existing llava_analysis artifact
        db.prepare(
          "DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = 'llava_analysis'"
        ).run(item.id);
        insertArtifact.run(item.id, jsonStr);
        // Insert FTS entry (contentless table — duplicates cleaned up by rebuild)
        insertFts.run(item.id, result.description, result.tags.join(", "), item.filename, item.location_name ?? "");
        markDone.run(item.id);
      })();
      succeeded++;
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error(`LLaVA analysis failed for ${item.absolute_path}: ${errMsg}`);
      db.transaction(() => {
        markError.run(item.id);
        db.prepare("DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = 'llava_error'").run(item.id);
        db.prepare("INSERT INTO ai_artifacts (media_item_id, kind, json) VALUES (?, 'llava_error', ?)").run(
          item.id, JSON.stringify({ error: errMsg, timestamp: new Date().toISOString() })
        );
      })();
      failed++;
    }
  });

  // Recreate FTS index (contentless FTS5 doesn't support rebuild)
  if (succeeded > 0) {
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

  const remaining = countRemaining(volume, type);
  return { processed: analyzable.length, succeeded, failed, remaining };
}

function countRemaining(volume?: string, type?: string): number {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const typeClause = type ? " AND type = ?" : "";
  const params: string[] = [];
  if (volume) params.push(volume);
  if (type) params.push(type);
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE availability = 'online'
         AND llava_state IN ('not_started', 'queued')
         AND (
           (type = 'video' AND ai_state = 'done')
           OR type = 'photo'
         )${volumeClause}${typeClause}`
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

// ── Background worker ───────────────────────────────────────────

interface BackgroundState {
  running: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
  volume?: string;
  type?: string;
  limit?: number;
  startedAt?: number;
}

const bgState: BackgroundState = {
  running: false,
  processed: 0,
  succeeded: 0,
  failed: 0,
  remaining: 0,
};

export function getBackgroundStatus(): BackgroundState {
  return { ...bgState };
}

export function startBackgroundAnalysis(volume?: string, limit?: number, type?: string): boolean {
  if (bgState.running) return false; // already running

  bgState.running = true;
  bgState.processed = 0;
  bgState.succeeded = 0;
  bgState.failed = 0;
  bgState.remaining = 0;
  bgState.volume = volume;
  bgState.type = type;
  bgState.limit = limit;
  bgState.startedAt = Date.now();

  // Fire and forget — runs in the background
  (async () => {
    try {
      while (bgState.running) {
        if (bgState.limit != null && bgState.processed >= bgState.limit) break;
        const res = await analyzeBatch(bgState.volume, bgState.type);
        bgState.processed += res.processed;
        bgState.succeeded += res.succeeded;
        bgState.failed += res.failed;
        bgState.remaining = res.remaining;
        if (res.processed === 0) break;
      }
    } catch (err) {
      console.error("Background LLaVA analysis error:", (err as Error).message);
    } finally {
      bgState.running = false;
    }
  })();

  return true;
}

export function stopBackgroundAnalysis(): boolean {
  if (!bgState.running) return false;
  bgState.running = false;
  return true;
}

// ── Status ─────────────────────────────────────────────────────

export function llavaStatus(volume?: string, type?: string): LlavaStatus {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const typeClause = type ? " AND type = ?" : "";
  const params: string[] = [];
  if (volume) params.push(volume);
  if (type) params.push(type);

  const rows = db
    .prepare(
      `SELECT llava_state, COUNT(*) as count FROM media_items
       WHERE availability = 'online'${volumeClause}${typeClause}
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
         )${volumeClause}${typeClause}`
    )
    .get(...params) as { count: number };
  counts.analyzable = analyzableRow.count;

  return counts;
}
