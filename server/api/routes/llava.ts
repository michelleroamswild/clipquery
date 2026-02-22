import { Router } from "express";
import {
  analyzeBatch,
  llavaStatus,
  checkOllamaHealth,
} from "../../indexer/llava-analyze.js";

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

/** GET /api/llava/status — Counts by llava_state */
router.get("/llava/status", (req, res) => {
  const volume = req.query.volume as string | undefined;
  res.json(llavaStatus(volume));
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
