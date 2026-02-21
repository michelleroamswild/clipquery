import { execSync } from "node:child_process";
import { readdirSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";
import { platform } from "node:os";

export interface VolumeInfo {
  name: string;
  uuid: string | null;
}

export interface MountedVolume {
  name: string;
  mountPoint: string;
  uuid: string | null;
}

/**
 * List mounted external volumes under /Volumes on macOS.
 * Skips hidden entries and the root volume symlink (e.g. "Macintosh HD" → "/").
 * Returns [] on non-macOS platforms.
 */
export function listMountedVolumes(): MountedVolume[] {
  if (platform() !== "darwin") return [];

  try {
    const entries = readdirSync("/Volumes");
    const volumes: MountedVolume[] = [];

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;

      const mountPoint = `/Volumes/${entry}`;

      // Skip symlinks pointing to root (the boot volume alias)
      try {
        const stat = lstatSync(mountPoint);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(mountPoint);
          if (target === "/") continue;
        }
      } catch {
        continue;
      }

      const uuid = getVolumeUuid(mountPoint);
      volumes.push({ name: entry, mountPoint, uuid });
    }

    return volumes;
  } catch {
    return [];
  }
}

/**
 * Detect macOS volume name and UUID from a file path.
 * For paths under /Volumes/<name>, extracts the volume name and queries diskutil.
 * For paths on the root volume, uses "Macintosh HD" as the name.
 */
export function getVolumeInfo(filePath: string): VolumeInfo {
  const resolved = path.resolve(filePath);

  // Check if path is under /Volumes/<name>
  const volumeMatch = resolved.match(/^\/Volumes\/([^/]+)/);
  if (volumeMatch) {
    const name = volumeMatch[1];
    const uuid = getVolumeUuid(`/Volumes/${name}`);
    return { name, uuid };
  }

  // Root volume
  return { name: "Macintosh HD", uuid: getVolumeUuid("/") };
}

function getVolumeUuid(mountPoint: string): string | null {
  try {
    const output = execSync(`diskutil info "${mountPoint}"`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    const match = output.match(/Volume UUID:\s+([A-F0-9-]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
