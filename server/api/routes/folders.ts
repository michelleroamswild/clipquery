import { Router } from "express";
import { getDb } from "../../db/connection.js";

const router = Router();

/** GET /api/folders?volume=X&parent=/path - List child folders for a volume */
router.get("/folders", (req, res) => {
  const volume = req.query.volume as string | undefined;
  if (!volume) {
    res.status(400).json({ error: "volume query parameter is required" });
    return;
  }

  const db = getDb();
  const parent = req.query.parent as string | undefined;

  if (parent) {
    // Get immediate children of the given parent folder
    const prefix = parent.endsWith("/") ? parent : parent + "/";
    const rows = db
      .prepare(
        `SELECT
           SUBSTR(dir, :prefixLen + 1) AS rel,
           SUM(cnt) AS itemCount
         FROM (
           SELECT
             REPLACE(absolute_path, '/' || filename, '') AS dir,
             1 AS cnt
           FROM media_items
           WHERE volume_name = :volume
             AND dir LIKE :likePattern
         )
         WHERE rel != ''
         GROUP BY CASE
           WHEN INSTR(rel, '/') > 0 THEN SUBSTR(rel, 1, INSTR(rel, '/') - 1)
           ELSE rel
         END`
      )
      .all({
        volume,
        prefixLen: prefix.length,
        likePattern: prefix + "%",
      }) as { rel: string; itemCount: number }[];

    // Aggregate by immediate child name
    const childMap = new Map<string, number>();
    for (const row of rows) {
      const slash = row.rel.indexOf("/");
      const childName = slash > 0 ? row.rel.substring(0, slash) : row.rel;
      childMap.set(childName, (childMap.get(childName) ?? 0) + row.itemCount);
    }

    // Check which children have sub-children
    const folders = [...childMap.entries()].map(([name, itemCount]) => {
      const childPath = prefix + name;
      const hasChildren =
        (db
          .prepare(
            `SELECT 1 FROM media_items
             WHERE volume_name = :volume
               AND REPLACE(absolute_path, '/' || filename, '') LIKE :pattern
             LIMIT 1`
          )
          .get({ volume, pattern: childPath + "/%" }) as unknown) != null;

      return { name, path: childPath, itemCount, hasChildren };
    });

    folders.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ folders });
  } else {
    // Root-level folders for this volume
    const rows = db
      .prepare(
        `SELECT
           REPLACE(absolute_path, '/' || filename, '') AS dir,
           COUNT(*) AS cnt
         FROM media_items
         WHERE volume_name = :volume
         GROUP BY dir`
      )
      .all({ volume }) as { dir: string; cnt: number }[];

    // Find common prefix to determine root
    if (rows.length === 0) {
      res.json({ folders: [] });
      return;
    }

    // Find the volume mount point prefix (shortest common directory prefix)
    const allDirs = rows.map((r) => r.dir);
    const parts0 = allDirs[0].split("/");
    let commonLen = parts0.length;
    for (const dir of allDirs) {
      const parts = dir.split("/");
      commonLen = Math.min(commonLen, parts.length);
      for (let i = 0; i < commonLen; i++) {
        if (parts[i] !== parts0[i]) {
          commonLen = i;
          break;
        }
      }
    }
    const rootPrefix = parts0.slice(0, commonLen).join("/");
    const prefixLen = rootPrefix.length + 1; // +1 for trailing slash

    // Aggregate by top-level child under root
    const childMap = new Map<string, number>();
    for (const row of rows) {
      const rel = row.dir.substring(prefixLen);
      if (!rel) {
        // Files directly in the root
        childMap.set(".", (childMap.get(".") ?? 0) + row.cnt);
        continue;
      }
      const slash = rel.indexOf("/");
      const childName = slash > 0 ? rel.substring(0, slash) : rel;
      childMap.set(childName, (childMap.get(childName) ?? 0) + row.cnt);
    }

    const folders = [...childMap.entries()]
      .filter(([name]) => name !== ".")
      .map(([name, itemCount]) => {
        const childPath = rootPrefix + "/" + name;
        const hasChildren =
          (db
            .prepare(
              `SELECT 1 FROM media_items
               WHERE volume_name = :volume
                 AND REPLACE(absolute_path, '/' || filename, '') LIKE :pattern
               LIMIT 1`
            )
            .get({ volume, pattern: childPath + "/%" }) as unknown) != null;

        return { name, path: childPath, itemCount, hasChildren };
      });

    // Include root items count if any
    const rootItems = childMap.get(".") ?? 0;

    folders.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ folders, rootPath: rootPrefix, rootItems });
  }
});

/** PATCH /api/folders/location - Update location for all items under a folder */
router.patch("/folders/location", (req, res) => {
  const { folderPath, locationName, latitude, longitude, includeSubfolders, preserveExistingGps } =
    req.body as {
      folderPath: string;
      locationName: string;
      latitude?: number;
      longitude?: number;
      includeSubfolders?: boolean;
      preserveExistingGps?: boolean;
    };

  if (!folderPath || !locationName) {
    res.status(400).json({ error: "folderPath and locationName are required" });
    return;
  }

  const db = getDb();

  let whereClause: string;
  const params: Record<string, unknown> = {};

  if (includeSubfolders) {
    const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
    whereClause = `(REPLACE(absolute_path, '/' || filename, '') = :folderPath OR absolute_path LIKE :likePattern)`;
    params.folderPath = folderPath;
    params.likePattern = prefix + "%";
  } else {
    whereClause = `REPLACE(absolute_path, '/' || filename, '') = :folderPath`;
    params.folderPath = folderPath;
  }

  // Always update location_name on all matching rows
  const nameResult = db
    .prepare(`UPDATE media_items SET location_name = :locationName WHERE ${whereClause}`)
    .run({ ...params, locationName });

  let gpsUpdated = 0;
  if (latitude != null && longitude != null) {
    const preserve = preserveExistingGps !== false; // default true
    const gpsWhere = preserve
      ? `${whereClause} AND latitude IS NULL AND longitude IS NULL`
      : whereClause;

    const gpsResult = db
      .prepare(`UPDATE media_items SET latitude = :latitude, longitude = :longitude WHERE ${gpsWhere}`)
      .run({ ...params, latitude, longitude });
    gpsUpdated = gpsResult.changes;
  }

  res.json({ updated: nameResult.changes, gpsUpdated });
});

export default router;
