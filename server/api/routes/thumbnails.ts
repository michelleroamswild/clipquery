import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  generatePosterFrames,
  extractPosterFrame,
  thumbnailStatus,
  getThumbnailsDir,
} from "../../indexer/poster-frame.js";
import {
  generatePhotoThumbs,
  photoThumbStatus,
  photoThumbPath,
} from "../../indexer/photo-thumbs.js";
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

/** POST /api/thumbnails/generate/:id — Generate thumbnail for a single video */
router.post("/thumbnails/generate/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, absolute_path, type FROM media_items WHERE id = ?")
    .get(id) as { id: number; absolute_path: string; type: string } | undefined;

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (row.type !== "video") {
    res.status(400).json({ error: "Not a video" });
    return;
  }
  if (!fs.existsSync(row.absolute_path)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  const thumbsDir = getThumbnailsDir();
  const outputPath = path.join(thumbsDir, `${row.id}.jpg`);

  try {
    await extractPosterFrame(row.absolute_path, outputPath);
    db.prepare("UPDATE media_items SET ai_state = 'done' WHERE id = ?").run(row.id);
    res.json({ ok: true, ai_state: "done" });
  } catch (err) {
    db.prepare("UPDATE media_items SET ai_state = 'error' WHERE id = ?").run(row.id);
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

/** GET /api/thumbnails/photo/:id — Serve photo thumbnail, preferring local cache */
router.get("/thumbnails/photo/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const cachedPath = photoThumbPath(id);

  // 1. Prefer local cache — works offline, fast, small
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", "image/jpeg");
    fs.createReadStream(cachedPath).pipe(res);
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

  // 2. Drive is mounted — for web-native formats, stream the original once
  //    (caching the downscaled version is what the batch generator does).
  if (WEB_NATIVE_EXTS.has(ext)) {
    const contentType = PHOTO_CONTENT_TYPES[ext] || "application/octet-stream";
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", contentType);
    fs.createReadStream(row.absolute_path).pipe(res);
    return;
  }

  // 3. Non-native formats: convert to JPEG on the fly and cache for next time
  try {
    await execFileAsync("ffmpeg", [
      "-i", row.absolute_path,
      "-vf", "scale=320:-1",
      "-frames:v", "1",
      "-q:v", "6",
      "-y",
      cachedPath,
    ], { timeout: 30_000 });

    if (!fs.existsSync(cachedPath) || fs.statSync(cachedPath).size === 0) {
      throw new Error("ffmpeg produced no output");
    }
  } catch {
    try {
      await execFileAsync("bash", [
        "-c",
        `exiftool -b -PreviewImage "${row.absolute_path}" > "${cachedPath}"`,
      ], { timeout: 30_000 });
    } catch {
      // both methods failed
    }
  }

  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
    res.set("Cache-Control", "public, max-age=604800, immutable");
    res.set("Content-Type", "image/jpeg");
    fs.createReadStream(cachedPath).pipe(res);
  } else {
    res.status(500).json({ error: "Failed to generate thumbnail" });
  }
});

/** POST /api/thumbnails/photos/generate — Process one batch of photo thumbnails */
router.post("/thumbnails/photos/generate", async (req, res) => {
  try {
    const volume = req.query.volume as string | undefined;
    const result = await generatePhotoThumbs(volume);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/thumbnails/photos/status — Counts by ai_state for photos */
router.get("/thumbnails/photos/status", (req, res) => {
  const volume = req.query.volume as string | undefined;
  res.json(photoThumbStatus(volume));
});

export default router;
