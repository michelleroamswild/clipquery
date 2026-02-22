import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { getDb } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");
const CURRENT_VERSION = 4;

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

  // Apply base schema (handles fresh installs via CREATE IF NOT EXISTS,
  // and creates indexes/FTS tables for existing databases)
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  conn.exec(schema);

  // Upsert version
  if (tableExists) {
    conn.prepare("UPDATE schema_version SET version = ?").run(CURRENT_VERSION);
  } else {
    conn.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      CURRENT_VERSION
    );
  }
}
