import { Router } from "express";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import exifr from "exifr";
import { getDb } from "../../db/connection.js";
import { geocodeBatch, geocodePending } from "../../geocode.js";
import { GPS_CAPABLE_EXTS } from "../../indexer/exif.js";

const router = Router();

/** GET /api/media - List media with filters */
router.get("/media", (req, res) => {
  const db = getDb();

  const type = req.query.type as string | undefined;
  const availability = req.query.availability as string | undefined;
  const volume = req.query.volume as string | undefined;
  const fileExt = req.query.file_ext as string | undefined;
  const hasGps = req.query.has_gps as string | undefined;
  const minRating = req.query.min_rating as string | undefined;
  const tag = req.query.tag as string | undefined;
  const llavaState = req.query.llava_state as string | undefined;
  const llavaVersion = req.query.llava_version as string | undefined;
  const mtimeSince = req.query.mtime_since as string | undefined;
  const orientation = req.query.orientation as string | undefined;
  const markedForDelete = req.query.marked_for_delete as string | undefined;
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
  if (minRating) {
    const mr = parseInt(minRating);
    if (!isNaN(mr) && mr >= 1 && mr <= 5) {
      conditions.push("rating >= @minRating");
      params.minRating = mr;
    }
  }
  if (tag) {
    conditions.push(
      "EXISTS (SELECT 1 FROM media_tags mt JOIN tags t ON mt.tag_id = t.id WHERE mt.media_item_id = media_items.id AND t.name = @tag)"
    );
    params.tag = tag;
  }
  if (hasGps === "true") {
    conditions.push("latitude IS NOT NULL AND longitude IS NOT NULL");
  } else if (hasGps === "false") {
    conditions.push("(latitude IS NULL OR longitude IS NULL)");
  }
  if (llavaState) {
    conditions.push("llava_state = @llavaState");
    params.llavaState = llavaState;
  }
  if (llavaVersion) {
    const ver = parseInt(llavaVersion);
    if (!isNaN(ver)) {
      conditions.push("llava_version = @llavaVersion");
      params.llavaVersion = ver;
    }
  }
  if (mtimeSince) {
    const sinceMs = parseInt(mtimeSince);
    if (!isNaN(sinceMs)) {
      conditions.push("mtime_ms >= @mtimeSince");
      params.mtimeSince = sinceMs;
    }
  }

  if (markedForDelete === "true") {
    conditions.push("marked_for_delete = 1");
  } else if (markedForDelete === "false") {
    conditions.push("marked_for_delete = 0");
  }

  if (orientation === "landscape") {
    conditions.push("width IS NOT NULL AND width > height");
  } else if (orientation === "portrait") {
    conditions.push("height IS NOT NULL AND height > width");
  } else if (orientation === "square") {
    conditions.push("width IS NOT NULL AND width = height");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSorts = ["updated_at", "filename", "size_bytes", "mtime_ms", "created_at", "rating"];
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

/** GET /api/geocode/search?q=... - Forward geocode (search for a place name) */
router.get("/geocode/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ClipQuery/1.0" },
    });
    if (!resp.ok) {
      res.status(502).json({ error: "Nominatim request failed" });
      return;
    }
    const data = (await resp.json()) as { display_name: string; lat: string; lon: string }[];
    const results = data.map((r) => ({
      display_name: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/media/:id/mark-delete - Toggle marked for delete */
router.post("/media/:id/mark-delete", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { marked } = req.body as { marked: boolean };

  if (typeof marked !== "boolean") {
    res.status(400).json({ error: "marked must be a boolean" });
    return;
  }

  const item = db.prepare("SELECT id FROM media_items WHERE id = ?").get(id);
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  db.prepare("UPDATE media_items SET marked_for_delete = ? WHERE id = ?").run(marked ? 1 : 0, id);
  res.json({ marked });
});

/** POST /api/media/:id/rating - Set rating (0-5) */
router.post("/media/:id/rating", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { rating } = req.body as { rating: number };

  if (typeof rating !== "number" || rating < 0 || rating > 5 || !Number.isInteger(rating)) {
    res.status(400).json({ error: "rating must be an integer 0-5" });
    return;
  }

  const item = db.prepare("SELECT id FROM media_items WHERE id = ?").get(id);
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  db.prepare("UPDATE media_items SET rating = ? WHERE id = ?").run(rating, id);
  res.json({ rating });
});

/** GET /api/media/:id/stream - Stream original media file with range support */
router.get("/media/:id/stream", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const item = db.prepare("SELECT absolute_path, availability FROM media_items WHERE id = ?").get(id) as
    | { absolute_path: string; availability: string }
    | undefined;
  if (!item || item.availability !== "online") {
    res.status(404).json({ error: "Not found or offline" });
    return;
  }

  const filePath = item.absolute_path;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";
  const fileSize = stat.size;

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/** POST /api/media/:id/exif - Extract and cache EXIF camera metadata */
router.post("/media/:id/exif", async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as
    | { absolute_path: string; file_ext: string; availability: string }
    | undefined;
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Check for cached result
  const cached = db
    .prepare("SELECT json FROM ai_artifacts WHERE media_item_id = ? AND kind = 'exif_data'")
    .get(id) as { json: string } | undefined;
  if (cached) {
    try {
      res.json(JSON.parse(cached.json));
    } catch {
      res.json(null);
    }
    return;
  }

  const ext = item.file_ext.toLowerCase();
  if (!GPS_CAPABLE_EXTS.has(ext)) {
    res.json(null);
    return;
  }

  try {
    const parsed = await exifr.parse(item.absolute_path);
    if (!parsed) {
      res.json(null);
      return;
    }

    const data = {
      cameraMake: parsed.Make ?? null,
      cameraModel: parsed.Model ?? null,
      lensModel: parsed.LensModel ?? null,
      iso: parsed.ISO ?? null,
      fNumber: parsed.FNumber ?? null,
      exposureTime: parsed.ExposureTime ?? null,
      focalLength: parsed.FocalLength ?? null,
      focalLength35mm: parsed.FocalLengthIn35mmFormat ?? null,
      whiteBalance: parsed.WhiteBalance != null ? String(parsed.WhiteBalance) : null,
      exposureProgram: parsed.ExposureProgram != null ? String(parsed.ExposureProgram) : null,
      flash: parsed.Flash != null ? String(parsed.Flash) : null,
      dateTimeOriginal: parsed.DateTimeOriginal
        ? (parsed.DateTimeOriginal instanceof Date
            ? parsed.DateTimeOriginal.toISOString()
            : String(parsed.DateTimeOriginal))
        : null,
    };

    // Cache as ai_artifact
    db.prepare(
      `INSERT INTO ai_artifacts (media_item_id, kind, json, timestamp_sec)
       VALUES (?, 'exif_data', ?, ?)`
    ).run(id, JSON.stringify(data), Math.floor(Date.now() / 1000));

    res.json(data);
  } catch {
    res.json(null);
  }
});

export default router;
