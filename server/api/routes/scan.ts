import { Router } from "express";
import { indexDirectories } from "../../indexer/index-media.js";

const router = Router();

/** POST /api/scan - Trigger a scan on given directories */
router.post("/scan", async (req, res) => {
  const { directories } = req.body as { directories?: string[] };

  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    res.status(400).json({ error: "directories must be a non-empty array of paths" });
    return;
  }

  // Validate that all entries are non-empty strings
  for (const dir of directories) {
    if (typeof dir !== "string" || dir.trim().length < 2) {
      res.status(400).json({ error: `Invalid directory path: ${dir}` });
      return;
    }
  }

  const result = await indexDirectories(directories);
  res.json(result);
});

export default router;
