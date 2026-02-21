import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  generatePosterFrames,
  thumbnailStatus,
  getThumbnailsDir,
} from "../../indexer/poster-frame.js";
import { getDb } from "../../db/connection.js";

const execFileAsync = promisify(execFile);

const router = Router();

/** Extensions browsers can render natively */
const WEB_NATIVE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);

const PHOTO_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/** POST /api/thumbnails/generate — Process one batch of poster frames */
router.post("/thumbnails/generate", async (req, res) => {
  try {
    const volume = req.query.volume as string | undefined;
    const result = await generatePosterFrames(volume);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/thumbnails/status — Counts by ai_state for videos */
router.get("/thumbnails/status", (req, res) => {
  const volume = req.query.volume as string | undefined;
  res.json(thumbnailStatus(volume));
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

/** GET /api/thumbnails/photo/:id — Serve photo thumbnail (convert non-web formats to JPEG) */
router.get("/thumbnails/photo/:id", async (req, res) => {
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

  // Browser-native formats: stream original file directly
  if (WEB_NATIVE_EXTS.has(ext)) {
    const contentType = PHOTO_CONTENT_TYPES[ext] || "application/octet-stream";
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", contentType);
    fs.createReadStream(row.absolute_path).pipe(res);
    return;
  }

  // Non-native formats (.dng, .heic, .tiff, .cr2, .nef, etc.): convert to JPEG and cache
  const thumbsDir = getThumbnailsDir();
  const cachedPath = path.join(thumbsDir, `photo-${id}.jpg`);

  if (fs.existsSync(cachedPath)) {
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", "image/jpeg");
    fs.createReadStream(cachedPath).pipe(res);
    return;
  }

  try {
    await execFileAsync("ffmpeg", [
      "-i", row.absolute_path,
      "-vf", "scale=320:-1",
      "-frames:v", "1",
      "-q:v", "6",
      "-y",
      cachedPath,
    ], { timeout: 30_000 });

    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", "image/jpeg");
    fs.createReadStream(cachedPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to convert image" });
  }
});

export default router;
