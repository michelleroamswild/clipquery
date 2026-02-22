import { Router } from "express";
import { execFile } from "child_process";
import { getDb } from "../../db/connection.js";
import { geocodeBatch, geocodePending } from "../../geocode.js";

const router = Router();

/** GET /api/media - List media with filters */
router.get("/media", (req, res) => {
  const db = getDb();

  const type = req.query.type as string | undefined;
  const availability = req.query.availability as string | undefined;
  const volume = req.query.volume as string | undefined;
  const fileExt = req.query.file_ext as string | undefined;
  const hasGps = req.query.has_gps as string | undefined;
  const mtimeSince = req.query.mtime_since as string | undefined;
  const sort = (req.query.sort as string) || "updated_at";
  const order = (req.query.order as string) || "desc";
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;

  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (type) {
    conditions.push("type = @type");
    params.type = type;
  }
  if (availability) {
    conditions.push("availability = @availability");
    params.availability = availability;
  }
  if (volume) {
    conditions.push("volume_name = @volume");
    params.volume = volume;
  }
  if (fileExt) {
    conditions.push("file_ext = @fileExt");
    params.fileExt = fileExt.startsWith(".") ? fileExt : `.${fileExt}`;
  }
  if (hasGps === "true") {
    conditions.push("latitude IS NOT NULL AND longitude IS NOT NULL");
  } else if (hasGps === "false") {
    conditions.push("(latitude IS NULL OR longitude IS NULL)");
  }
  if (mtimeSince) {
    const sinceMs = parseInt(mtimeSince);
    if (!isNaN(sinceMs)) {
      conditions.push("mtime_ms >= @mtimeSince");
      params.mtimeSince = sinceMs;
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSorts = ["updated_at", "filename", "size_bytes", "mtime_ms", "created_at"];
  const sortCol = allowedSorts.includes(sort) ? sort : "updated_at";
  const sortDir = order === "asc" ? "ASC" : "DESC";

  const items = db
    .prepare(
      `SELECT * FROM media_items ${where} ORDER BY ${sortCol} ${sortDir} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM media_items ${where}`)
    .get(params) as { total: number };

  res.json({ items, total: countRow.total, limit, offset });
});

/** GET /api/media/extensions - Distinct file extensions */
router.get("/media/extensions", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT file_ext FROM media_items ORDER BY file_ext")
    .all() as { file_ext: string }[];
  res.json({ extensions: rows.map((r) => r.file_ext) });
});

/** GET /api/media/stats - Aggregate counts */
router.get("/media/stats", (_req, res) => {
  const db = getDb();

  const byType = db
    .prepare("SELECT type, COUNT(*) as count FROM media_items GROUP BY type")
    .all() as { type: string; count: number }[];

  const byVolume = db
    .prepare(
      "SELECT volume_name, COUNT(*) as count FROM media_items GROUP BY volume_name"
    )
    .all() as { volume_name: string; count: number }[];

  const byAvailability = db
    .prepare(
      "SELECT availability, COUNT(*) as count FROM media_items GROUP BY availability"
    )
    .all() as { availability: string; count: number }[];

  const byIndexState = db
    .prepare(
      "SELECT index_state, COUNT(*) as count FROM media_items GROUP BY index_state"
    )
    .all() as { index_state: string; count: number }[];

  const byAiState = db
    .prepare(
      "SELECT ai_state, COUNT(*) as count FROM media_items GROUP BY ai_state"
    )
    .all() as { ai_state: string; count: number }[];

  const volumeDetails = db
    .prepare(
      `SELECT volume_name, type, COUNT(*) as count
       FROM media_items GROUP BY volume_name, type`
    )
    .all() as { volume_name: string; type: string; count: number }[];

  const volumeLastScan = db
    .prepare(
      `SELECT volume_name, MAX(updated_at) as last_updated
       FROM media_items GROUP BY volume_name`
    )
    .all() as { volume_name: string; last_updated: string }[];

  // Build a per-volume summary
  const volMap = new Map<string, { total: number; videos: number; photos: number; lastScan: string | null }>();
  for (const row of volumeDetails) {
    const entry = volMap.get(row.volume_name) ?? { total: 0, videos: 0, photos: 0, lastScan: null };
    entry.total += row.count;
    if (row.type === "video") entry.videos = row.count;
    if (row.type === "photo") entry.photos = row.count;
    volMap.set(row.volume_name, entry);
  }
  for (const row of volumeLastScan) {
    const entry = volMap.get(row.volume_name);
    if (entry) entry.lastScan = row.last_updated;
  }
  const byVolumeDetail = Array.from(volMap.entries()).map(([name, d]) => ({
    volume_name: name,
    total: d.total,
    videos: d.videos,
    photos: d.photos,
    lastScan: d.lastScan,
  }));

  const totalRow = db
    .prepare("SELECT COUNT(*) as total FROM media_items")
    .get() as { total: number };

  res.json({
    total: totalRow.total,
    byType,
    byVolume,
    byVolumeDetail,
    byAvailability,
    byIndexState,
    byAiState,
  });
});

/** GET /api/media/:id - Single item with ai_artifacts */
router.get("/media/:id", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id);
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const artifacts = db
    .prepare("SELECT * FROM ai_artifacts WHERE media_item_id = ? ORDER BY timestamp_sec")
    .all(id);

  res.json({ item, artifacts });
});

/** POST /api/open-in-finder - Reveal file in macOS Finder */
router.post("/open-in-finder", (req, res) => {
  const { path } = req.body;
  if (typeof path !== "string" || !path) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  execFile("open", ["-R", path], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ ok: true });
  });
});

/** POST /api/geocode - Batch reverse-geocode items with GPS but no location name */
router.post("/geocode", async (_req, res) => {
  try {
    const pending = geocodePending();
    if (pending === 0) {
      res.json({ processed: 0, remaining: 0 });
      return;
    }
    const processed = await geocodeBatch(10);
    const remaining = geocodePending();
    res.json({ processed, remaining });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/geocode/status - Check how many items need geocoding */
router.get("/geocode/status", (_req, res) => {
  res.json({ pending: geocodePending() });
});

export default router;
