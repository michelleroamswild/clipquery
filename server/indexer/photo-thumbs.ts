import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";
import { processWithConcurrency } from "./utils.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const BATCH_SIZE = 25;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;
const LONG_EDGE = 1024;

/** ffmpeg filter that caps either dimension at LONG_EDGE while preserving aspect */
const SCALE_FILTER = `scale='if(gte(iw,ih),${LONG_EDGE},-1)':'if(gte(ih,iw),${LONG_EDGE},-1)'`;

/** Extensions ffmpeg can decode directly without a RAW fallback */
const FFMPEG_FRIENDLY_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
]);

function ensureDir(): void {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }
}

export function photoThumbPath(id: number): string {
  return path.join(THUMBNAILS_DIR, `photo-${id}.jpg`);
}

/** Scale a source image file to LONG_EDGE and write the result to outputPath. */
async function ffmpegScale(source: string, outputPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-i", source,
      "-vf", SCALE_FILTER,
      "-frames:v", "1",
      "-q:v", "6",
      "-y",
      outputPath,
    ],
    { timeout: TIMEOUT_MS }
  );
}

/** Generate a 1024px long-edge JPEG preview for a single photo.
 *  RAW/HEIC: extract the embedded preview with exiftool, then downscale via ffmpeg.
 *  Throws if no usable preview could be produced. */
export async function extractPhotoThumb(
  inputPath: string,
  outputPath: string,
  fileExt: string
): Promise<void> {
  const ext = fileExt.toLowerCase();

  // ffmpeg-friendly formats: decode directly, scale, done.
  if (FFMPEG_FRIENDLY_EXTS.has(ext)) {
    try {
      await ffmpegScale(inputPath, outputPath);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
    } catch {
      // fall through to exiftool path
    }
  }

  // RAW / HEIC / etc.: extract embedded preview (often 1920+ px), then downscale.
  const rawPreview = `${outputPath}.rawpreview.jpg`;
  try {
    await execFileAsync(
      "bash",
      ["-c", `exiftool -b -PreviewImage "${inputPath}" > "${rawPreview}"`],
      { timeout: TIMEOUT_MS }
    );
    if (!fs.existsSync(rawPreview) || fs.statSync(rawPreview).size === 0) {
      // Exiftool may fail silently; try JpgFromRaw as a secondary
      await execFileAsync(
        "bash",
        ["-c", `exiftool -b -JpgFromRaw "${inputPath}" > "${rawPreview}"`],
        { timeout: TIMEOUT_MS }
      );
    }
    if (!fs.existsSync(rawPreview) || fs.statSync(rawPreview).size === 0) {
      throw new Error("no preview extracted");
    }
    await ffmpegScale(rawPreview, outputPath);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error("ffmpeg downscale produced no output");
    }
  } finally {
    if (fs.existsSync(rawPreview)) fs.unlinkSync(rawPreview);
  }
}

export interface GenerateResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

/** Process one batch of photos: generate thumbnails and update ai_state */
export async function generatePhotoThumbs(volume?: string): Promise<GenerateResult> {
  ensureDir();
  const db = getDb();

  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params: (string | number)[] = volume ? [volume, BATCH_SIZE] : [BATCH_SIZE];
  const items = db
    .prepare(
      `SELECT id, absolute_path, file_ext FROM media_items
       WHERE type = 'photo'
         AND availability = 'online'
         AND ai_state IN ('not_started', 'queued')${volumeClause}
       LIMIT ?`
    )
    .all(...params) as { id: number; absolute_path: string; file_ext: string }[];

  if (items.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: countPending(volume) };
  }

  const markQueued = db.prepare("UPDATE media_items SET ai_state = 'queued' WHERE id = ? AND type = 'photo'");
  db.transaction(() => {
    for (const item of items) markQueued.run(item.id);
  })();

  const markDone = db.prepare("UPDATE media_items SET ai_state = 'done' WHERE id = ? AND type = 'photo'");
  const markError = db.prepare("UPDATE media_items SET ai_state = 'error' WHERE id = ? AND type = 'photo'");

  let succeeded = 0;
  let failed = 0;

  await processWithConcurrency(items, CONCURRENCY, async (item) => {
    const outputPath = photoThumbPath(item.id);

    // If a cached thumbnail already exists (e.g. from on-demand RAW conversion), just mark done.
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      markDone.run(item.id);
      succeeded++;
      return;
    }

    try {
      await extractPhotoThumb(item.absolute_path, outputPath, item.file_ext);
      markDone.run(item.id);
      succeeded++;
    } catch (err) {
      console.error(`Photo thumb failed for ${item.absolute_path}: ${(err as Error).message}`);
      markError.run(item.id);
      failed++;
    }
  });

  return { processed: items.length, succeeded, failed, remaining: countPending(volume) };
}

function countPending(volume?: string): number {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE type = 'photo'
         AND availability = 'online'
         AND ai_state IN ('not_started', 'queued')${volumeClause}`
    )
    .get(...params) as { count: number };
  return row.count;
}

export interface PhotoThumbStatus {
  pending: number;
  queued: number;
  done: number;
  error: number;
}

export function photoThumbStatus(volume?: string): PhotoThumbStatus {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const rows = db
    .prepare(
      `SELECT ai_state, COUNT(*) as count FROM media_items
       WHERE type = 'photo' AND availability = 'online'${volumeClause}
       GROUP BY ai_state`
    )
    .all(...params) as { ai_state: string; count: number }[];

  const counts: PhotoThumbStatus = { pending: 0, queued: 0, done: 0, error: 0 };
  for (const row of rows) {
    if (row.ai_state === "not_started") counts.pending = row.count;
    else if (row.ai_state === "queued") counts.queued = row.count;
    else if (row.ai_state === "done") counts.done = row.count;
    else if (row.ai_state === "error") counts.error = row.count;
  }
  return counts;
}
