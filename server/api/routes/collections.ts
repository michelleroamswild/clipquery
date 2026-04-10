import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/collections - List all collections with item count + cover thumbnails */
router.get("/collections", (_req, res) => {
  const db = getDb();
  const collections = db
    .prepare(
      `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
              COUNT(ci.media_item_id) as itemCount
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at DESC`
    )
    .all() as Array<{
    id: number;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    itemCount: number;
  }>;

  // Get first 4 media IDs for cover thumbnails per collection
  const coverStmt = db.prepare(
    `SELECT ci.media_item_id FROM collection_items ci
     WHERE ci.collection_id = ?
     ORDER BY ci.position, ci.added_at
     LIMIT 4`
  );

  const result = collections.map((c) => {
    const coverRows = coverStmt.all(c.id) as { media_item_id: number }[];
    return { ...c, coverIds: coverRows.map((r) => r.media_item_id) };
  });

  res.json({ collections: result });
});

/** POST /api/collections - Create a collection */
router.post("/collections", (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const result = db
      .prepare("INSERT INTO collections (name, description) VALUES (?, ?)")
      .run(name.trim(), description || null);
    const collection = db
      .prepare("SELECT * FROM collections WHERE id = ?")
      .get(result.lastInsertRowid);
    res.json(collection);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "Collection name already exists" });
      return;
    }
    throw err;
  }
});

/** PATCH /api/collections/:id - Update collection */
router.patch("/collections/:id", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { name, description } = req.body;

  const existing = db.prepare("SELECT * FROM collections WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const sets: string[] = [];
  const params: Record<string, string | number> = { id };
  if (name !== undefined) {
    sets.push("name = @name");
    params.name = name;
  }
  if (description !== undefined) {
    sets.push("description = @description");
    params.description = description;
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }

  const updated = db.prepare("SELECT * FROM collections WHERE id = ?").get(id);
  res.json(updated);
});

/** DELETE /api/collections/:id - Delete collection */
router.delete("/collections/:id", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  res.json({ ok: true });
});

/** GET /api/collections/:id - Collection detail with ordered items */
router.get("/collections/:id", (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const collection = db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!collection) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const items = db
    .prepare(
      `SELECT m.*, ci.position, ci.added_at as collection_added_at
       FROM collection_items ci
       JOIN media_items m ON m.id = ci.media_item_id
       WHERE ci.collection_id = ?
       ORDER BY ci.position, ci.added_at`
    )
    .all(id);

  res.json({ ...collection, items });
});

/** POST /api/collections/:id/items - Add items to collection */
router.post("/collections/:id/items", (req, res) => {
  const db = getDb();
  const collectionId = parseInt(req.params.id);
  const { mediaIds } = req.body;
  if (!Array.isArray(mediaIds)) {
    res.status(400).json({ error: "mediaIds[] is required" });
    return;
  }

  // Get current max position
  const maxRow = db
    .prepare("SELECT MAX(position) as maxPos FROM collection_items WHERE collection_id = ?")
    .get(collectionId) as { maxPos: number | null };
  let pos = (maxRow?.maxPos ?? -1) + 1;

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO collection_items (collection_id, media_item_id, position) VALUES (?, ?, ?)"
  );
  const bulk = db.transaction(() => {
    for (const mediaId of mediaIds) {
      stmt.run(collectionId, mediaId, pos++);
    }
  });
  bulk();

  // Update collection timestamp
  db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(
    collectionId
  );

  res.json({ ok: true });
});

/** DELETE /api/collections/:id/items/:mediaId - Remove item from collection */
router.delete("/collections/:id/items/:mediaId", (req, res) => {
  const db = getDb();
  const collectionId = parseInt(req.params.id);
  const mediaId = parseInt(req.params.mediaId);
  db.prepare(
    "DELETE FROM collection_items WHERE collection_id = ? AND media_item_id = ?"
  ).run(collectionId, mediaId);
  db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(
    collectionId
  );
  res.json({ ok: true });
});

/** PATCH /api/collections/:id/items/reorder - Reorder items */
router.patch("/collections/:id/items/reorder", (req, res) => {
  const db = getDb();
  const collectionId = parseInt(req.params.id);
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: "orderedIds[] is required" });
    return;
  }

  const stmt = db.prepare(
    "UPDATE collection_items SET position = ? WHERE collection_id = ? AND media_item_id = ?"
  );
  const reorder = db.transaction(() => {
    orderedIds.forEach((mediaId: number, index: number) => {
      stmt.run(index, collectionId, mediaId);
    });
  });
  reorder();

  db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(
    collectionId
  );
  res.json({ ok: true });
});

export default router;
