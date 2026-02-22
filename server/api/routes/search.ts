import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/search?q=&limit=&offset= — Full-text search across LLaVA descriptions + tags */
router.get("/search", (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q || !q.trim()) {
    res.status(400).json({ error: "Missing search query parameter 'q'" });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const db = getDb();

    const rows = db
      .prepare(
        `SELECT m.*, fts.rank AS score,
                json_extract(a.json, '$.description') AS fts_description,
                COALESCE((SELECT GROUP_CONCAT(value, ', ') FROM json_each(a.json, '$.tags')), '') AS fts_tags
         FROM media_fts fts
         JOIN media_items m ON m.id = fts.rowid
         LEFT JOIN ai_artifacts a ON a.media_item_id = m.id AND a.kind = 'llava_analysis'
         WHERE media_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ? OFFSET ?`
      )
      .all(q.trim(), limit, offset) as Record<string, unknown>[];

    // Get total count for pagination
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM media_fts WHERE media_fts MATCH ?`
      )
      .get(q.trim()) as { total: number };

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
