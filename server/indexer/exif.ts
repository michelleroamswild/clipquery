import exifr from "exifr";
import { extractVideoGps } from "./video-gps.js";

/** Extensions that can contain EXIF GPS data */
export const GPS_CAPABLE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  // RAW formats
  ".arw",
  ".cr2",
  ".cr3",
  ".nef",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
]);

/** Video extensions with possible GPS in ©xyz atom */
const VIDEO_GPS_EXTS = new Set([".mp4", ".mov", ".m4v"]);

export interface GpsCoords {
  latitude: number;
  longitude: number;
}

/**
 * Extract GPS coordinates from a file's metadata.
 * Uses EXIF for images, ©xyz atom parsing for MP4/MOV.
 */
export async function extractGps(
  absolutePath: string,
  fileExt: string
): Promise<GpsCoords | null> {
  if (VIDEO_GPS_EXTS.has(fileExt)) {
    return extractVideoGps(absolutePath);
  }

  if (!GPS_CAPABLE_EXTS.has(fileExt)) {
    return null;
  }

  try {
    const gps = await exifr.gps(absolutePath);
    if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
      return { latitude: gps.latitude, longitude: gps.longitude };
    }
    return null;
  } catch {
    // Corrupt file or unreadable EXIF — skip silently
    return null;
  }
}
