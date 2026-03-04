import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { getDb } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");
const CURRENT_VERSION = 7;

export function runMigrations(db?: Database.Database): void {
  const conn = db ?? getDb();

  // Check if schema_version table exists
  const tableExists = conn
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get();

  let currentVersion = 0;
  if (tableExists) {
    const row = conn.prepare("SELECT version FROM schema_version").get() as
      | { version: number }
      | undefined;
    currentVersion = row?.version ?? 0;
    if (currentVersion >= CURRENT_VERSION) {
      return; // Already up to date
    }
  }

  // Incremental migrations for existing databases (must run BEFORE schema.sql
  // so that ALTER TABLE adds columns before CREATE INDEX references them)
  if (currentVersion < 2) {
    // v1 → v2: Add GPS coordinate columns
    const cols = conn.pragma("table_info(media_items)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("latitude")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN latitude REAL;");
    }
    if (!colNames.has("longitude")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN longitude REAL;");
    }
  }

  if (currentVersion < 3) {
    // v2 → v3: Add location_name column
    const cols = conn.pragma("table_info(media_items)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("location_name")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN location_name TEXT;");
    }
  }

  if (currentVersion < 4) {
    // v3 → v4: Add llava_state column
    const cols = conn.pragma("table_info(media_items)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("llava_state")) {
      conn.exec(
        `ALTER TABLE media_items ADD COLUMN llava_state TEXT NOT NULL DEFAULT 'not_started'`
      );
    }
  }

  if (currentVersion < 5) {
    // v4 → v5: Rebuild FTS with filename + location_name columns, populate for all items
    conn.exec("DROP TABLE IF EXISTS media_fts");
  }

  if (currentVersion < 6) {
    // v5 → v6: Add llava_version column to track analysis prompt version
    const cols = conn.pragma("table_info(media_items)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("llava_version")) {
      conn.exec(
        `ALTER TABLE media_items ADD COLUMN llava_version INTEGER NOT NULL DEFAULT 0`
      );
      // Mark existing analyzed items as v1
      conn.exec(
        `UPDATE media_items SET llava_version = 1 WHERE llava_state = 'done'`
      );
    }
  }

  if (currentVersion < 7) {
    // v6 → v7: Add storage helper columns
    const cols = conn.pragma("table_info(media_items)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("phash")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN phash TEXT;");
    }
    if (!colNames.has("blur_score")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN blur_score REAL;");
    }
    if (!colNames.has("duration_sec")) {
      conn.exec("ALTER TABLE media_items ADD COLUMN duration_sec REAL;");
    }
    if (!colNames.has("storage_scan_state")) {
      conn.exec(
        `ALTER TABLE media_items ADD COLUMN storage_scan_state TEXT NOT NULL DEFAULT 'not_started'`
      );
    }
  }

  // Apply base schema (handles fresh installs via CREATE IF NOT EXISTS,
  // and creates indexes/FTS tables for existing databases)
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  conn.exec(schema);

  if (currentVersion < 5) {
    // Populate FTS for ALL media items (join ai_artifacts for description/tags where available)
    conn.exec(`
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

  // Upsert version
  if (tableExists) {
    conn.prepare("UPDATE schema_version SET version = ?").run(CURRENT_VERSION);
  } else {
    conn.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_VERSION
    );
  }
}
