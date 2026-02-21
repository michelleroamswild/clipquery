import fs from "node:fs";
import path from "node:path";

const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
]);

export interface ScannedFile {
  absolutePath: string;
  filename: string;
  fileExt: string;
  sizeBytes: number;
  mtimeMs: number;
  createdTimeMs: number;
  type: "video" | "photo";
}

const VIDEO_EXTS = new Set([".mp4", ".mov"]);

/**
 * Generator that recursively walks a directory tree and yields media files.
 * Skips hidden directories, node_modules, and .Trash.
 */
export function* scanDirectory(rootDir: string): Generator<ScannedFile> {
  const resolved = path.resolve(rootDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    // Permission denied or not a directory - skip silently
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(resolved, entry.name);

    // Skip hidden dirs, node_modules, .Trash
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      yield* scanDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(ext)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      yield {
        absolutePath: fullPath,
        filename: entry.name,
        fileExt: ext,
        sizeBytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        createdTimeMs: Math.floor(stat.birthtimeMs),
        type: VIDEO_EXTS.has(ext) ? "video" : "photo",
      };
    }
  }
}
