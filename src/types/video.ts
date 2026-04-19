import type { MediaItemRow } from "@/lib/api-client";

export interface VideoFile {
  id: number;
  type: "video" | "photo";
  filename: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAt: Date;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  aiState: string;
  llavaState: string;
}

export interface SearchResult {
  video: VideoFile;
  mediaItem?: MediaItemRow;
  timestamp: number; // seconds
  confidence: number; // 0-1
}

export type SortOption = "newest" | "shortest-timestamp";
/** Convert a DB row to the VideoFile shape used by existing components */
export function mediaRowToVideoFile(row: MediaItemRow): VideoFile {
  return {
    id: row.id,
    type: row.type,
    filename: row.filename,
    fullPath: row.absolute_path,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.mtime_ms),
    latitude: row.latitude,
    longitude: row.longitude,
    locationName: row.location_name,
    aiState: row.ai_state,
    llavaState: row.llava_state,
  };
}
