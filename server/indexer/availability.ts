import { getDb } from "../db/connection.js";
import { listMountedVolumes } from "./volume.js";

/**
 * Sync media_items availability based on which volumes are currently mounted.
 * - Files on unmounted external volumes → 'offline'
 * - Files on mounted external volumes → 'online'
 * - Files on the root volume (paths not under /Volumes/) are always 'online'
 */
export function syncVolumeAvailability(): void {
  const db = getDb();
  const mounted = listMountedVolumes();
  const mountedNames = new Set(mounted.map((v) => v.name));

  // Get all distinct volume names that have items in the database
  const dbVolumes = db
    .prepare("SELECT DISTINCT volume_name FROM media_items WHERE volume_name IS NOT NULL")
    .all() as { volume_name: string }[];

  let markedOffline = 0;
  let markedOnline = 0;

  for (const { volume_name } of dbVolumes) {
    // Check if this is an external volume by looking at a sample file path.
    // External volumes have files under /Volumes/<name>/..., root volume files
    // live under /Users/... etc.
    const sample = db
      .prepare("SELECT absolute_path FROM media_items WHERE volume_name = ? LIMIT 1")
      .get(volume_name) as { absolute_path: string } | undefined;

    const isExternal = sample?.absolute_path?.startsWith("/Volumes/") ?? false;

    if (!isExternal) {
      // Root/boot volume — always online
      const result = db
        .prepare(
          "UPDATE media_items SET availability = 'online' WHERE volume_name = ? AND availability = 'offline'"
        )
        .run(volume_name);
      markedOnline += result.changes;
      continue;
    }

    if (mountedNames.has(volume_name)) {
      // External volume is mounted — mark its offline items as online
      const result = db
        .prepare(
          "UPDATE media_items SET availability = 'online' WHERE volume_name = ? AND availability = 'offline'"
        )
        .run(volume_name);
      markedOnline += result.changes;
    } else {
      // External volume is not mounted — mark its online items as offline
      const result = db
        .prepare(
          "UPDATE media_items SET availability = 'offline' WHERE volume_name = ? AND availability = 'online'"
        )
        .run(volume_name);
      markedOffline += result.changes;
    }
  }

  if (markedOffline > 0 || markedOnline > 0) {
    console.log(
      `Availability sync: ${markedOffline} items marked offline, ${markedOnline} items marked online`
    );
  }
}
