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

/** Extract a poster frame for a single video. Returns the output path on success. */
async function extractPosterFrame(
  inputPath: string,
  outputPath: string
): Promise<void> {
  // Fast seek to 1s and grab a single frame
  await execFileAsync(
    "ffmpeg",
    [
      "-ss", "1",
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
export async function generatePosterFrames(volume?: string): Promise<GenerateResult> {
  ensureDir();
  const db = getDb();

  // Pick items to process
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params: (string | number)[] = volume ? [volume, BATCH_SIZE] : [BATCH_SIZE];
  const items = db
    .prepare(
      `SELECT id, absolute_path FROM media_items
       WHERE type = 'video'
         AND availability = 'online'
         AND ai_state IN ('not_started', 'queued')${volumeClause}
       LIMIT ?`
    )
    .all(...params) as { id: number; absolute_path: string }[];

  if (items.length === 0) {
    const remaining = countByState("not_started", volume) + countByState("queued", volume);
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

  const remaining = countByState("not_started", volume) + countByState("queued", volume);
  return { processed: items.length, succeeded, failed, remaining };
}

function countByState(state: string, volume?: string): number {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [state, volume] : [state];
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE type = 'video' AND availability = 'online' AND ai_state = ?${volumeClause}`
    )
    .get(...params) as { count: number };
  return row.count;
}

export interface ThumbnailStatus {
  pending: number;
  queued: number;
  done: number;
  error: number;
}

/** Get counts of videos by ai_state */
export function thumbnailStatus(volume?: string): ThumbnailStatus {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const rows = db
    .prepare(
      `SELECT ai_state, COUNT(*) as count FROM media_items
       WHERE type = 'video' AND availability = 'online'${volumeClause}
       GROUP BY ai_state`
    )
    .all(...params) as { ai_state: string; count: number }[];

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
