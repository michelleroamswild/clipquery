import { Router } from "express";
import {
  analyzeBatch,
  analyzeImage,
  getImagePath,
  llavaStatus,
  checkOllamaHealth,
  startBackgroundAnalysis,
  stopBackgroundAnalysis,
  getBackgroundStatus,
} from "../../indexer/llava-analyze.js";
import { getDb } from "../../db/connection.js";

const router = Router();

/** POST /api/llava/analyze — Process one batch of LLaVA analysis */
router.post("/llava/analyze", async (req, res) => {
  try {
    const volume = req.query.volume as string | undefined;
    const result = await analyzeBatch(volume);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/llava/start — Start background analysis (runs server-side) */
router.post("/llava/start", (req, res) => {
  const volume = req.query.volume as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const type = req.query.type as string | undefined;
  const started = startBackgroundAnalysis(volume, limit, type);
  if (!started) {
    res.json({ started: false, message: "Already running" });
  } else {
    res.json({ started: true });
  }
});

/** POST /api/llava/stop — Stop background analysis */
router.post("/llava/stop", (_req, res) => {
  const stopped = stopBackgroundAnalysis();
  res.json({ stopped, ...getBackgroundStatus() });
});

/** GET /api/llava/background — Get background analysis progress */
router.get("/llava/background", (_req, res) => {
  res.json(getBackgroundStatus());
});

/** GET /api/llava/status — Counts by llava_state */
router.get("/llava/status", (req, res) => {
  const volume = req.query.volume as string | undefined;
  const type = req.query.type as string | undefined;
  res.json(llavaStatus(volume, type));
});

/** POST /api/llava/reanalyze/:id — Re-analyze a single item */
router.post("/llava/reanalyze/:id", async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const item = db.prepare(
    "SELECT id, type, absolute_path, filename, file_ext, ai_state, location_name FROM media_items WHERE id = ?"
  ).get(id) as { id: number; type: "video" | "photo"; absolute_path: string; filename: string; file_ext: string; ai_state: string; location_name: string | null } | undefined;

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const imgPath = getImagePath(item);
  if (!imgPath) {
    res.status(400).json({ error: "No image available for analysis" });
    return;
  }

  try {
    const result = await analyzeImage(imgPath, item.absolute_path);
    const jsonStr = JSON.stringify({ ...result, version: 2 });

    db.transaction(() => {
      db.prepare("DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = 'llava_analysis'").run(id);
      db.prepare("INSERT INTO ai_artifacts (media_item_id, kind, json) VALUES (?, 'llava_analysis', ?)").run(id, jsonStr);
      db.prepare("UPDATE media_items SET llava_state = 'done', llava_version = 2 WHERE id = ?").run(id);
    })();

    // Rebuild FTS
    db.exec(`DROP TABLE IF EXISTS media_fts`);
    db.exec(`CREATE VIRTUAL TABLE media_fts USING fts5(description, tags, filename, location_name, content='', content_rowid='rowid')`);
    db.exec(`
      INSERT INTO media_fts (rowid, description, tags, filename, location_name)
        SELECT m.id,
               COALESCE(json_extract(a.json, '$.description'), ''),
               COALESCE((SELECT GROUP_CONCAT(value, ', ') FROM json_each(a.json, '$.tags')), ''),
               m.filename,
               COALESCE(m.location_name, '')
        FROM media_items m
        LEFT JOIN ai_artifacts a ON a.media_item_id = m.id AND a.kind = 'llava_analysis'
    `);

    res.json({ ok: true, result: JSON.parse(jsonStr) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/llava/health — Check if Ollama is running and model is loaded */
router.get("/llava/health", async (_req, res) => {
  try {
    const health = await checkOllamaHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
