#!/usr/bin/env tsx
/**
 * One-off pass: resize bloated photo-*.jpg thumbnails down to a 1024px long edge.
 *
 * Background: the exiftool RAW fallback in photo-thumbs.ts returns the
 * embedded preview at whatever size the camera wrote it — often 1920×1080 or
 * bigger, ~360 KB/file. This script walks data/thumbnails, probes each file's
 * width, and re-encodes anything wider than THRESHOLD via ffmpeg.
 *
 * Usage: npx tsx server/indexer/resize-photo-thumbs.ts [--dry-run]
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const TARGET_LONG_EDGE = 1024;
const THRESHOLD = 1200; // only resize if wider than this (keeps us from re-encoding already-small files)
const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;

const dryRun = process.argv.includes("--dry-run");

interface FileInfo {
  path: string;
  originalBytes: number;
  width: number;
}

async function probeWidth(file: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width",
        "-of", "csv=p=0",
        file,
      ],
      { timeout: TIMEOUT_MS }
    );
    const w = parseInt(stdout.trim(), 10);
    return Number.isFinite(w) ? w : null;
  } catch {
    return null;
  }
}

async function resizeInPlace(file: string): Promise<boolean> {
  const tmp = `${file}.resizing.jpg`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i", file,
        "-vf", `scale='if(gte(iw,ih),${TARGET_LONG_EDGE},-1)':'if(gte(ih,iw),${TARGET_LONG_EDGE},-1)'`,
        "-frames:v", "1",
        "-q:v", "6",
        "-y",
        tmp,
      ],
      { timeout: TIMEOUT_MS }
    );
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      return false;
    }
    fs.renameSync(tmp, file);
    return true;
  } catch {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return false;
  }
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const files = fs
    .readdirSync(THUMBNAILS_DIR)
    .filter((n) => n.startsWith("photo-") && n.endsWith(".jpg"))
    .map((n) => path.join(THUMBNAILS_DIR, n));

  console.log(`Scanning ${files.length.toLocaleString()} photo thumbnails in ${THUMBNAILS_DIR}`);
  console.log(`Target long edge: ${TARGET_LONG_EDGE}px · Threshold: ${THRESHOLD}px · Concurrency: ${CONCURRENCY}`);
  if (dryRun) console.log(`[DRY RUN] No files will be modified.`);

  // Phase 1: probe widths and gather candidates
  const candidates: FileInfo[] = [];
  let probed = 0;
  let skippedSmall = 0;
  let probeFailed = 0;

  await processWithConcurrency(files, CONCURRENCY, async (file) => {
    probed++;
    if (probed % 2000 === 0) {
      process.stdout.write(`\rProbed ${probed.toLocaleString()} / ${files.length.toLocaleString()}`);
    }
    const width = await probeWidth(file);
    if (width == null) {
      probeFailed++;
      return;
    }
    if (width <= THRESHOLD) {
      skippedSmall++;
      return;
    }
    const stat = fs.statSync(file);
    candidates.push({ path: file, originalBytes: stat.size, width });
  });

  process.stdout.write(`\rProbed ${probed.toLocaleString()} / ${files.length.toLocaleString()}\n`);
  console.log(`  Skipped (≤${THRESHOLD}px): ${skippedSmall.toLocaleString()}`);
  console.log(`  Probe failed: ${probeFailed.toLocaleString()}`);
  console.log(`  Candidates: ${candidates.length.toLocaleString()}`);

  const totalOriginal = candidates.reduce((s, c) => s + c.originalBytes, 0);
  console.log(`  Total bytes of candidates: ${formatBytes(totalOriginal)}`);

  if (candidates.length === 0 || dryRun) {
    console.log(dryRun ? "Dry run complete." : "Nothing to do.");
    return;
  }

  // Phase 2: resize
  let resized = 0;
  let failed = 0;
  let bytesSaved = 0;

  await processWithConcurrency(candidates, CONCURRENCY, async (info, i) => {
    const ok = await resizeInPlace(info.path);
    if (!ok) {
      failed++;
      return;
    }
    const newBytes = fs.existsSync(info.path) ? fs.statSync(info.path).size : 0;
    bytesSaved += info.originalBytes - newBytes;
    resized++;
    if (resized % 500 === 0 || i === candidates.length - 1) {
      process.stdout.write(
        `\rResized ${resized.toLocaleString()} / ${candidates.length.toLocaleString()} · reclaimed ${formatBytes(bytesSaved)}`
      );
    }
  });

  process.stdout.write("\n");
  console.log(`Done.`);
  console.log(`  Resized: ${resized.toLocaleString()}`);
  console.log(`  Failed: ${failed.toLocaleString()}`);
  console.log(`  Space reclaimed: ${formatBytes(bytesSaved)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
