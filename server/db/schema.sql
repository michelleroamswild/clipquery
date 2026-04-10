-- clipquery schema v12

CREATE TABLE IF NOT EXISTS media_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK (type IN ('video', 'photo')),
  absolute_path TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  file_ext      TEXT NOT NULL,
  volume_name   TEXT,
  volume_id     TEXT,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  created_time_ms INTEGER,
  content_hash  TEXT,
  latitude      REAL,
  longitude     REAL,
  location_name TEXT,
  availability  TEXT NOT NULL DEFAULT 'online' CHECK (availability IN ('online', 'offline')),
  index_state   TEXT NOT NULL DEFAULT 'unindexed' CHECK (index_state IN ('unindexed', 'needs_reindex', 'indexed')),
  ai_state      TEXT NOT NULL DEFAULT 'not_started' CHECK (ai_state IN ('not_started', 'queued', 'done', 'error')),
  llava_state   TEXT NOT NULL DEFAULT 'not_started' CHECK (llava_state IN ('not_started', 'queued', 'done', 'error')),
  llava_version INTEGER NOT NULL DEFAULT 0,
  phash         TEXT,
  blur_score    REAL,
  duration_sec  REAL,
  width         INTEGER,
  height        INTEGER,
  storage_scan_state TEXT NOT NULL DEFAULT 'not_started' CHECK (storage_scan_state IN ('not_started', 'queued', 'done', 'error')),
  rating        INTEGER NOT NULL DEFAULT 0,
  marked_for_delete INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS media_tags (
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, media_item_id)
);

CREATE TABLE IF NOT EXISTS ai_artifacts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id  INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  timestamp_sec  REAL,
  path           TEXT,
  json           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full-text search on LLaVA descriptions + tags + filename + location
CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  description,
  tags,
  filename,
  location_name,
  content='',
  content_rowid='rowid'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_path ON media_items(absolute_path);
CREATE INDEX IF NOT EXISTS idx_media_volume ON media_items(volume_name);
CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_availability ON media_items(availability);
CREATE INDEX IF NOT EXISTS idx_media_index_state ON media_items(index_state);
CREATE INDEX IF NOT EXISTS idx_media_llava_state ON media_items(llava_state);
CREATE INDEX IF NOT EXISTS idx_media_phash ON media_items(phash);
CREATE INDEX IF NOT EXISTS idx_media_storage_scan ON media_items(storage_scan_state);
CREATE INDEX IF NOT EXISTS idx_ai_artifacts_media ON ai_artifacts(media_item_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_media ON media_tags(media_item_id);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_media ON collection_items(media_item_id);

-- Auto-update updated_at
CREATE TRIGGER IF NOT EXISTS trg_media_items_updated_at
  AFTER UPDATE ON media_items
  FOR EACH ROW
BEGIN
  UPDATE media_items SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
