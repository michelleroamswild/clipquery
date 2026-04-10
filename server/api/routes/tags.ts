import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/tags - List all tags with usage count */
router.get("/tags", (_req, res) => {
  const db = getDb();
  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(mt.media_item_id) as count
       FROM tags t
       LEFT JOIN media_tags mt ON mt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    )
    .all();
  res.json({ tags });
});

/** POST /api/tags - Create a tag */
router.post("/tags", (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const result = db
      .prepare("INSERT INTO tags (name, color) VALUES (?, ?)")
      .run(name.trim(), color || null);
    const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(result.lastInsertRowid);
    res.json(tag);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "Tag already exists" });
      return;
    }
    throw err;
  }
});

/** DELETE /api/tags/:id - Delete a tag */
router.delete("/tags/:id", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  res.json({ ok: true });
});

/** GET /api/media/:id/tags - Tags for a media item */
router.get("/media/:id/tags", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN media_tags mt ON mt.tag_id = t.id
       WHERE mt.media_item_id = ?
       ORDER BY t.name`
    )
    .all(id);
  res.json({ tags });
});

/** POST /api/media/:id/tags - Add tag to item (by tagId or create-on-fly by name) */
router.post("/media/:id/tags", (req, res) => {
  const db = getDb();
  const mediaId = parseInt(req.params.id);
  let { tagId, name, color } = req.body;

  if (!tagId && !name) {
    res.status(400).json({ error: "tagId or name is required" });
    return;
  }

  if (!tagId && name) {
    // Create-on-fly or find existing
    const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(name.trim()) as
      | { id: number }
      | undefined;
    if (existing) {
      tagId = existing.id;
    } else {
      const result = db
        .prepare("INSERT INTO tags (name, color) VALUES (?, ?)")
        .run(name.trim(), color || null);
      tagId = result.lastInsertRowid;
    }
  }

  try {
    db.prepare(
      "INSERT OR IGNORE INTO media_tags (media_item_id, tag_id) VALUES (?, ?)"
    ).run(mediaId, tagId);
  } catch {
    // ignore FK violations for non-existent items
  }

  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color
       FROM tags t JOIN media_tags mt ON mt.tag_id = t.id
       WHERE mt.media_item_id = ?
       ORDER BY t.name`
    )
    .all(mediaId);
  res.json({ tags });
});

/** DELETE /api/media/:id/tags/:tagId - Remove tag from item */
router.delete("/media/:id/tags/:tagId", (req, res) => {
  const db = getDb();
  const mediaId = parseInt(req.params.id);
  const tagId = parseInt(req.params.tagId);
  db.prepare("DELETE FROM media_tags WHERE media_item_id = ? AND tag_id = ?").run(
    mediaId,
    tagId
  );
  res.json({ ok: true });
});

/** POST /api/tags/bulk - Bulk add tag to multiple items */
router.post("/tags/bulk", (req, res) => {
  const db = getDb();
  const { tagId, mediaIds } = req.body;
  if (!tagId || !Array.isArray(mediaIds)) {
    res.status(400).json({ error: "tagId and mediaIds[] are required" });
    return;
  }
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO media_tags (media_item_id, tag_id) VALUES (?, ?)"
  );
  const bulk = db.transaction(() => {
    for (const id of mediaIds) {
      stmt.run(id, tagId);
    }
  });
  bulk();
  res.json({ ok: true, count: mediaIds.length });
});

export default router;
