import exifr from "exifr";

/** Extensions that can contain EXIF GPS data */
const GPS_CAPABLE_EXTS = new Set([
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

export interface GpsCoords {
  latitude: number;
  longitude: number;
}

/**
 * Extract GPS coordinates from a photo's EXIF data.
 * Returns null for non-GPS-capable formats or if no GPS data is present.
 */
export async function extractGps(
  absolutePath: string,
  fileExt: string
): Promise<GpsCoords | null> {
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
