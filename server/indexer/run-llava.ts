#!/usr/bin/env tsx
/**
 * CLI script to run LLaVA analysis continuously in the background.
 *
 * Usage:
 *   npx tsx server/indexer/run-llava.ts                   # analyze all
 *   npx tsx server/indexer/run-llava.ts --volume "2025 Pt2"
 *   npx tsx server/indexer/run-llava.ts --limit 500
 *   npm run analyze                                       # shortcut
 *   npm run analyze -- --volume "2025 Pt2" --limit 100
 */

import { runMigrations } from "../db/migrations.js";
import { closeDb } from "../db/connection.js";
import {
  analyzeBatch,
  llavaStatus,
  checkOllamaHealth,
} from "./llava-analyze.js";

// ── Parse CLI args ──────────────────────────────────────────────

function parseArgs(): { volume?: string; limit?: number } {
  const args = process.argv.slice(2);
  let volume: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--volume" && args[i + 1]) {
      volume = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit)) limit = undefined;
    }
  }
  return { volume, limit };
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const { volume, limit } = parseArgs();

  // Run migrations to ensure DB is up to date
  runMigrations();

  // Check Ollama health
  const health = await checkOllamaHealth();
  if (!health.running) {
    console.error("Ollama is not running. Start it with: ollama serve");
    process.exit(1);
  }
  if (!health.model_loaded) {
    console.error("LLaVA model not found. Pull it with: ollama pull llava:13b");
    process.exit(1);
  }

  // Show initial status
  const status = llavaStatus(volume);
  const scope = volume ? `volume "${volume}"` : "all volumes";
  console.log(`\nLLaVA Analysis — ${scope}`);
  console.log(`  Analyzable: ${status.analyzable.toLocaleString()}`);
  console.log(`  Already done: ${status.done.toLocaleString()}`);
  console.log(`  Errors: ${status.error.toLocaleString()}`);
  if (limit) console.log(`  Limit: ${limit.toLocaleString()}`);
  console.log("");

  if (status.analyzable === 0) {
    console.log("Nothing to analyze.");
    closeDb();
    return;
  }

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  const startTime = Date.now();

  // Handle Ctrl+C gracefully
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("\nStopping after current item...");
  });

  while (!stopping) {
    if (limit != null && totalProcessed >= limit) break;

    const res = await analyzeBatch(volume);

    if (res.processed === 0) {
      if (res.remaining === 0) break;
      // No analyzable items right now but some remain (e.g. missing thumbnails)
      console.log(`No analyzable items available. ${res.remaining} remaining need thumbnails first.`);
      break;
    }

    totalProcessed += res.processed;
    totalSucceeded += res.succeeded;
    totalFailed += res.failed;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = totalProcessed > 0 ? ((Date.now() - startTime) / 1000 / totalProcessed).toFixed(1) : "—";
    console.log(
      `[${elapsed}s] ${totalProcessed.toLocaleString()} done` +
      (limit ? ` of ${limit.toLocaleString()}` : "") +
      ` | ${res.remaining.toLocaleString()} remaining` +
      ` | ${rate}s/item` +
      (totalFailed > 0 ? ` | ${totalFailed} failed` : "")
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone. ${totalSucceeded} succeeded, ${totalFailed} failed in ${elapsed}s.`);
  closeDb();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeDb();
  process.exit(1);
});
