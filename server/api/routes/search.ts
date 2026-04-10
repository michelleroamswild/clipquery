import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** Escape special FTS5 characters and wrap each token in quotes */
function sanitizeFtsQuery(q: string, operator: "AND" | "OR" = "AND"): string {
  // Split into words, quote each one to avoid FTS5 syntax issues
  const tokens = q
    .replace(/[.,:;!?(){}[\]"*^~]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(` ${operator} `);
}

/** GET /api/search?q=&limit=&offset= — Full-text search across LLaVA descriptions + tags */
router.get("/search", (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q || !q.trim()) {
    res.status(400).json({ error: "Missing search query parameter 'q'" });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const minDuration = req.query.min_duration ? parseFloat(req.query.min_duration as string) : null;
  const operator = req.query.operator === "or" ? "OR" : "AND";

  try {
    const db = getDb();
    const trimmed = q.trim();
    const ftsQuery = sanitizeFtsQuery(trimmed, operator);

    const durationFilter = minDuration != null ? `WHERE (:minDuration IS NULL OR duration_sec >= :minDuration)` : "";
    const params: Record<string, unknown> = { pattern: `%${trimmed}%`, ftsQuery, limit, offset };
    if (minDuration != null) params.minDuration = minDuration;

    // Always do filename LIKE match first (highest priority), then FTS results
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT m.*, -100 AS score,
                  json_extract(a.json, '$.description') AS fts_description,
                  COALESCE((SELECT GROUP_CONCAT(value, ', ') FROM json_each(a.json, '$.tags')), '') AS fts_tags
           FROM media_items m
           LEFT JOIN ai_artifacts a ON a.media_item_id = m.id AND a.kind = 'llava_analysis'
           WHERE m.filename LIKE :pattern
           UNION ALL
           SELECT m.*, fts.rank AS score,
                  json_extract(a.json, '$.description') AS fts_description,
                  COALESCE((SELECT GROUP_CONCAT(value, ', ') FROM json_each(a.json, '$.tags')), '') AS fts_tags
           FROM media_fts fts
           JOIN media_items m ON m.id = fts.rowid
           LEFT JOIN ai_artifacts a ON a.media_item_id = m.id AND a.kind = 'llava_analysis'
           WHERE media_fts MATCH :ftsQuery
             AND m.filename NOT LIKE :pattern
         ) ${durationFilter}
         ORDER BY score
         LIMIT :limit OFFSET :offset`
      )
      .all(params) as Record<string, unknown>[];

    const countParams: Record<string, unknown> = { pattern: `%${trimmed}%`, ftsQuery };
    if (minDuration != null) countParams.minDuration = minDuration;
    const countDurationJoin = minDuration != null
      ? `AND duration_sec >= :minDuration`
      : "";

    const countRow = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM media_items WHERE filename LIKE :pattern ${countDurationJoin}) +
           (SELECT COUNT(*) FROM media_fts JOIN media_items m ON m.id = media_fts.rowid WHERE media_fts MATCH :ftsQuery ${countDurationJoin}) AS total`
      )
      .get(countParams) as { total: number };

    const items = rows.map((row) => ({
      ...row,
      score: row.score,
      fts_description: row.fts_description,
      fts_tags: row.fts_tags,
    }));

    res.json({ items, total: countRow.total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
