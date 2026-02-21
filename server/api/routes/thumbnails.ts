import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import {
  generatePosterFrames,
  thumbnailStatus,
  getThumbnailsDir,
} from "../../indexer/poster-frame.js";
import { getDb } from "../../db/connection.js";

const router = Router();

const PHOTO_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
};

/** POST /api/thumbnails/generate — Process one batch of poster frames */
router.post("/thumbnails/generate", async (_req, res) => {
  try {
    const result = await generatePosterFrames();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/thumbnails/status — Counts by ai_state for videos */
router.get("/thumbnails/status", (_req, res) => {
  res.json(thumbnailStatus());
});

/** GET /api/thumbnails/file/:filename — Serve thumbnail JPEG with caching */
router.get("/thumbnails/file/:filename", (req, res) => {
  const filename = req.params.filename;
  // Sanitize: only allow <digits>.jpg
  if (!/^\d+\.jpg$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(getThumbnailsDir(), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.set("Cache-Control", "public, max-age=604800, immutable");
  res.set("Content-Type", "image/jpeg");
  fs.createReadStream(filePath).pipe(res);
});

/** GET /api/thumbnails/photo/:id — Serve original photo file as thumbnail */
router.get("/thumbnails/photo/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT absolute_path, file_ext FROM media_items WHERE id = ? AND type = 'photo'")
    .get(id) as { absolute_path: string; file_ext: string } | undefined;

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!fs.existsSync(row.absolute_path)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  const ext = row.file_ext.toLowerCase();
  const contentType = PHOTO_CONTENT_TYPES[ext] || "application/octet-stream";

  res.set("Cache-Control", "public, max-age=604800, immutable");
  res.set("Content-Type", contentType);
  fs.createReadStream(row.absolute_path).pipe(res);
});

export default router;
