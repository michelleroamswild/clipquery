import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { getDb } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");
const CURRENT_VERSION = 1;

export function runMigrations(db?: Database.Database): void {
  const conn = db ?? getDb();

  // Check if schema_version table exists
  const tableExists = conn
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get();

  if (tableExists) {
    const row = conn.prepare("SELECT version FROM schema_version").get() as
      | { version: number }
      | undefined;
    if (row && row.version >= CURRENT_VERSION) {
      return; // Already up to date
    }
  }

  // Apply schema
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
