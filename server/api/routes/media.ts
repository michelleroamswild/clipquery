import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/media - List media with filters */
router.get("/media", (req, res) => {
  const db = getDb();

  const type = req.query.type as string | undefined;
  const availability = req.query.availability as string | undefined;
  const volume = req.query.volume as string | undefined;
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

  const totalRow = db
    .prepare("SELECT COUNT(*) as total FROM media_items")
    .get() as { total: number };

  res.json({
    total: totalRow.total,
    byType,
    byVolume,
    byAvailability,
    byIndexState,
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

export default router;
