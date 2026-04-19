#!/usr/bin/env tsx
/**
 * CLI: run CLIP embedding generation in the background.
 *
 * Usage:
 *   npx tsx server/indexer/run-clip.ts                 # all
 *   npx tsx server/indexer/run-clip.ts --volume "2025"
 *   npx tsx server/indexer/run-clip.ts --limit 100
 *   npm run clip
 */

import { runMigrations } from "../db/migrations.js";
import { closeDb } from "../db/connection.js";
import { generateEmbeddings, clipStatus } from "./clip-embed.js";

function parseArgs(): { volume?: string; limit?: number } {
  const args = process.argv.slice(2);
  let volume: string | undefined;
  let limit: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--volume" && args[i + 1]) volume = args[++i];
    else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n)) limit = n;
    }
  }
  return { volume, limit };
}

async function main() {
  const { volume, limit } = parseArgs();
  runMigrations();

  const status = clipStatus(volume);
  console.log(
    `CLIP status${volume ? ` (volume=${volume})` : ""}: pending=${status.pending}, queued=${status.queued}, done=${status.done}, error=${status.error}`
  );

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  while (true) {
    if (limit != null && totalProcessed >= limit) {
      console.log(`Reached limit ${limit}. Stopping.`);
      break;
    }
    const res = await generateEmbeddings(volume);
    if (res.processed === 0) {
      console.log("Nothing left to process.");
      break;
    }
    totalProcessed += res.processed;
    totalSucceeded += res.succeeded;
    totalFailed += res.failed;
    totalSkipped += res.skipped;
    console.log(
      `batch: processed=${res.processed} succeeded=${res.succeeded} failed=${res.failed} skipped=${res.skipped} remaining=${res.remaining}`
    );
  }

  console.log(
    `Totals: processed=${totalProcessed} succeeded=${totalSucceeded} failed=${totalFailed} skipped=${totalSkipped}`
  );
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
