import { Router } from "express";
import { listMountedVolumes } from "../../indexer/volume.js";

const router = Router();

/** GET /api/volumes - List mounted external volumes */
router.get("/volumes", (_req, res) => {
  const volumes = listMountedVolumes();
  res.json({ volumes });
});

export default router;
