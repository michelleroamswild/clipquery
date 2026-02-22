import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/media/dashboard - Aggregated dashboard stats */
router.get("/media/dashboard", (_req, res) => {
  const db = getDb();

  // 1. Totals
  const totals = db
    .prepare("SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM media_items")
    .get() as { count: number; total_size: number };

  // 2. By type
  const byType = db
    .prepare("SELECT type, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size FROM media_items GROUP BY type")
    .all() as { type: string; count: number; size: number }[];

  // 3. LLaVA state
  const byLlavaState = db
    .prepare("SELECT llava_state as state, COUNT(*) as count FROM media_items GROUP BY llava_state")
    .all() as { state: string; count: number }[];

  // 4. AI state (poster frames)
  const byAiState = db
    .prepare("SELECT ai_state as state, COUNT(*) as count FROM media_items GROUP BY ai_state")
    .all() as { state: string; count: number }[];

  // 5. Top 15 locations
  const topLocations = db
    .prepare(
      "SELECT location_name, COUNT(*) as count FROM media_items WHERE location_name IS NOT NULL GROUP BY location_name ORDER BY count DESC LIMIT 15"
    )
    .all() as { location_name: string; count: number }[];

  // 6. Timeline (items per month)
  const timeline = db
    .prepare(
      "SELECT strftime('%Y-%m', datetime(mtime_ms / 1000, 'unixepoch')) as month, COUNT(*) as count FROM media_items GROUP BY month ORDER BY month"
    )
    .all() as { month: string; count: number }[];

  // 7. Top 10 file extensions
  const topExtensions = db
    .prepare("SELECT file_ext, COUNT(*) as count FROM media_items GROUP BY file_ext ORDER BY count DESC LIMIT 10")
    .all() as { file_ext: string; count: number }[];

  // 8. Volume breakdown
  const volumes = db
    .prepare(
      `SELECT volume_name, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size,
       SUM(CASE WHEN type='video' THEN 1 ELSE 0 END) as videos,
       SUM(CASE WHEN type='photo' THEN 1 ELSE 0 END) as photos
       FROM media_items GROUP BY volume_name`
    )
    .all() as { volume_name: string; count: number; size: number; videos: number; photos: number }[];

  // 9. Avg file size by type
  const avgSize = db
    .prepare("SELECT type, AVG(size_bytes) as avg_size FROM media_items GROUP BY type")
    .all() as { type: string; avg_size: number }[];

  // 10. GPS coverage
  const gps = db
    .prepare(
      `SELECT
        SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) as with_gps,
        SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) as without_gps
       FROM media_items`
    )
    .get() as { with_gps: number; without_gps: number };

  res.json({
    totals,
    byType,
    byLlavaState,
    byAiState,
    topLocations,
    timeline,
    topExtensions,
    volumes,
    avgSize,
    gps: { with_gps: gps?.with_gps ?? 0, without_gps: gps?.without_gps ?? 0 },
  });
});

export default router;
