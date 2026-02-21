import path from "node:path";
import fs from "node:fs";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { scanDirectory, type ScannedFile } from "./scanner.js";
import { getVolumeInfo } from "./volume.js";
import { extractGps } from "./exif.js";

const BATCH_SIZE = 500;
const GPS_CONCURRENCY = 50;

interface ScanSummary {
  directory: string;
  filesFound: number;
  markedOffline: number;
}

type BatchFile = ScannedFile & {
  volumeName: string;
  volumeId: string | null;
  isNew: number;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Run extractGps on a batch of files with bounded concurrency.
 */
async function enrichBatchWithGps(batch: BatchFile[]): Promise<void> {
  // Process in chunks of GPS_CONCURRENCY to avoid fd exhaustion
  for (let i = 0; i < batch.length; i += GPS_CONCURRENCY) {
    const chunk = batch.slice(i, i + GPS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((f) => extractGps(f.absolutePath, f.fileExt))
    );
    for (let j = 0; j < chunk.length; j++) {
      const gps = results[j];
      if (gps) {
        chunk[j].latitude = gps.latitude;
        chunk[j].longitude = gps.longitude;
      }
    }
  }
}

export async function indexDirectories(directories: string[]): Promise<{
  summaries: ScanSummary[];
  totalInDb: number;
}> {
  const db = getDb();
  runMigrations(db);

  const summaries: ScanSummary[] = [];

  const upsertStmt = db.prepare(`
    INSERT INTO media_items (
      type, absolute_path, filename, file_ext,
      volume_name, volume_id, size_bytes, mtime_ms,
      created_time_ms, latitude, longitude,
      availability, index_state
    ) VALUES (
      @type, @absolutePath, @filename, @fileExt,
      @volumeName, @volumeId, @sizeBytes, @mtimeMs,
      @createdTimeMs, @latitude, @longitude, 'online',
      CASE WHEN @isNew = 1 THEN 'unindexed' ELSE 'needs_reindex' END
    )
    ON CONFLICT(absolute_path) DO UPDATE SET
      size_bytes = CASE
        WHEN excluded.size_bytes != media_items.size_bytes
          OR excluded.mtime_ms != media_items.mtime_ms
        THEN excluded.size_bytes ELSE media_items.size_bytes END,
      mtime_ms = CASE
        WHEN excluded.size_bytes != media_items.size_bytes
          OR excluded.mtime_ms != media_items.mtime_ms
        THEN excluded.mtime_ms ELSE media_items.mtime_ms END,
      latitude = CASE
        WHEN excluded.latitude IS NOT NULL THEN excluded.latitude
        ELSE media_items.latitude END,
      longitude = CASE
        WHEN excluded.longitude IS NOT NULL THEN excluded.longitude
        ELSE media_items.longitude END,
      index_state = CASE
        WHEN excluded.size_bytes != media_items.size_bytes
          OR excluded.mtime_ms != media_items.mtime_ms
        THEN 'needs_reindex' ELSE media_items.index_state END,
      ai_state = CASE
        WHEN excluded.size_bytes != media_items.size_bytes
          OR excluded.mtime_ms != media_items.mtime_ms
        THEN 'not_started' ELSE media_items.ai_state END,
      availability = 'online',
      volume_name = excluded.volume_name,
      volume_id = excluded.volume_id
  `);

  const markOfflineStmt = db.prepare(`
    UPDATE media_items
    SET availability = 'offline'
    WHERE absolute_path LIKE @prefix || '%'
      AND availability = 'online'
      AND absolute_path NOT IN (SELECT value FROM json_each(@foundPaths))
  `);

  const batchInsert = db.transaction((files: BatchFile[]) => {
    for (const f of files) {
      upsertStmt.run({
        type: f.type,
        absolutePath: f.absolutePath,
        filename: f.filename,
        fileExt: f.fileExt,
        volumeName: f.volumeName,
        volumeId: f.volumeId,
        sizeBytes: f.sizeBytes,
        mtimeMs: f.mtimeMs,
        createdTimeMs: f.createdTimeMs,
        latitude: f.latitude,
        longitude: f.longitude,
        isNew: f.isNew,
      });
    }
  });

  for (const dir of directories) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      console.warn(`Skipping non-existent directory: ${resolved}`);
      summaries.push({ directory: resolved, filesFound: 0, markedOffline: 0 });
      continue;
    }

    console.log(`Scanning: ${resolved}`);
    const volumeInfo = getVolumeInfo(resolved);
    console.log(`  Volume: ${volumeInfo.name} (${volumeInfo.uuid ?? "no UUID"})`);

    // Check which paths already exist
    const existingPaths = new Set(
      (
        db
          .prepare(
            "SELECT absolute_path FROM media_items WHERE absolute_path LIKE ? || '%'"
          )
          .all(resolved) as { absolute_path: string }[]
      ).map((r) => r.absolute_path)
    );

    let batch: BatchFile[] = [];
    let filesFound = 0;
    const foundPaths: string[] = [];

    for (const file of scanDirectory(resolved)) {
      filesFound++;
      foundPaths.push(file.absolutePath);

      batch.push({
        ...file,
        volumeName: volumeInfo.name,
        volumeId: volumeInfo.uuid,
        isNew: existingPaths.has(file.absolutePath) ? 0 : 1,
        latitude: null,
        longitude: null,
      });

      if (batch.length >= BATCH_SIZE) {
        await enrichBatchWithGps(batch);
        batchInsert(batch);
        batch = [];
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await enrichBatchWithGps(batch);
      batchInsert(batch);
    }

    // Mark items not found in scan as offline
    const offlineResult = markOfflineStmt.run({
      prefix: resolved,
      foundPaths: JSON.stringify(foundPaths),
    });
    const markedOffline = offlineResult.changes;

    console.log(`  Found: ${filesFound} files, marked offline: ${markedOffline}`);
    summaries.push({ directory: resolved, filesFound, markedOffline });
  }

  const totalRow = db.prepare("SELECT COUNT(*) as count FROM media_items").get() as {
    count: number;
  };

  return { summaries, totalInDb: totalRow.count };
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  runCli();
}

async function runCli() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("Usage: tsx server/indexer/index-media.ts <dir1> [dir2] ...");
    process.exit(1);
  }

  console.log(`\nclipquery indexer`);
  console.log(`=================\n`);

  const { summaries, totalInDb } = await indexDirectories(dirs);

  console.log(`\n--- Summary ---`);
  for (const s of summaries) {
    console.log(`  ${s.directory}: ${s.filesFound} found, ${s.markedOffline} marked offline`);
  }
  console.log(`  Total items in DB: ${totalInDb}\n`);

  closeDb();
}
