import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const BATCH_SIZE = 100;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;

/** Ensure the thumbnails directory exists */
function ensureDir(): void {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }
}

/** Get video duration in seconds via ffprobe */
async function getVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        filePath,
      ],
      { timeout: TIMEOUT_MS }
    );
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format?.duration);
    return isNaN(duration) ? null : duration;
  } catch {
    return null;
  }
}

/** Extract a poster frame for a single video. Returns the output path on success. */
async function extractPosterFrame(
  inputPath: string,
  outputPath: string
): Promise<void> {
  // Primary: use thumbnail filter (picks most representative frame from first 300)
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i", inputPath,
        "-vf", "thumbnail=300,scale=320:-1",
        "-frames:v", "1",
        "-q:v", "6",
        "-y",
        outputPath,
      ],
      { timeout: TIMEOUT_MS }
    );
    // Verify output exists and is non-empty
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return;
    }
  } catch {
    // Fallback below
  }

  // Fallback: seek to 10% of duration
  const duration = await getVideoDuration(inputPath);
  const seekTo = duration ? Math.max(0, duration * 0.1) : 1;

  await execFileAsync(
    "ffmpeg",
    [
      "-ss", String(seekTo),
      "-i", inputPath,
      "-vf", "scale=320:-1",
      "-frames:v", "1",
      "-q:v", "6",
      "-y",
      outputPath,
    ],
    { timeout: TIMEOUT_MS }
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("ffmpeg produced no output");
  }
}

/** Process items with bounded concurrency */
async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export interface GenerateResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

/** Process one batch of videos: extract poster frames and update DB */
export async function generatePosterFrames(): Promise<GenerateResult> {
  ensureDir();
  const db = getDb();

  // Pick items to process
  const items = db
    .prepare(
      `SELECT id, absolute_path FROM media_items
       WHERE type = 'video'
         AND availability = 'online'
         AND ai_state IN ('not_started', 'queued')
       LIMIT ?`
    )
    .all(BATCH_SIZE) as { id: number; absolute_path: string }[];

  if (items.length === 0) {
    const remaining = countByState("not_started") + countByState("queued");
    return { processed: 0, succeeded: 0, failed: 0, remaining };
  }

  // Mark batch as queued
  const markQueued = db.prepare("UPDATE media_items SET ai_state = 'queued' WHERE id = ?");
  const markQueuedTx = db.transaction(() => {
    for (const item of items) markQueued.run(item.id);
  });
  markQueuedTx();

  const markDone = db.prepare("UPDATE media_items SET ai_state = 'done' WHERE id = ?");
  const markError = db.prepare("UPDATE media_items SET ai_state = 'error' WHERE id = ?");
  const insertArtifact = db.prepare(
    `INSERT INTO ai_artifacts (media_item_id, kind, path)
     VALUES (?, 'poster_frame', ?)`
  );

  let succeeded = 0;
  let failed = 0;

  await processWithConcurrency(items, CONCURRENCY, async (item) => {
    const outputPath = path.join(THUMBNAILS_DIR, `${item.id}.jpg`);
    try {
      await extractPosterFrame(item.absolute_path, outputPath);
      db.transaction(() => {
        // Remove any existing poster_frame artifact for this item
        db.prepare("DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = 'poster_frame'").run(item.id);
        insertArtifact.run(item.id, outputPath);
        markDone.run(item.id);
      })();
      succeeded++;
    } catch (err) {
      console.error(`Poster frame failed for ${item.absolute_path}: ${(err as Error).message}`);
      markError.run(item.id);
      failed++;
    }
  });

  const remaining = countByState("not_started") + countByState("queued");
  return { processed: items.length, succeeded, failed, remaining };
}

function countByState(state: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE type = 'video' AND availability = 'online' AND ai_state = ?`
    )
    .get(state) as { count: number };
  return row.count;
}

export interface ThumbnailStatus {
  pending: number;
  queued: number;
  done: number;
  error: number;
}

/** Get counts of videos by ai_state */
export function thumbnailStatus(): ThumbnailStatus {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ai_state, COUNT(*) as count FROM media_items
       WHERE type = 'video' AND availability = 'online'
       GROUP BY ai_state`
    )
    .all() as { ai_state: string; count: number }[];

  const counts: ThumbnailStatus = { pending: 0, queued: 0, done: 0, error: 0 };
  for (const row of rows) {
    if (row.ai_state === "not_started") counts.pending = row.count;
    else if (row.ai_state === "queued") counts.queued = row.count;
    else if (row.ai_state === "done") counts.done = row.count;
    else if (row.ai_state === "error") counts.error = row.count;
  }
  return counts;
}

/** Get the thumbnails directory path */
export function getThumbnailsDir(): string {
  ensureDir();
  return THUMBNAILS_DIR;
}
