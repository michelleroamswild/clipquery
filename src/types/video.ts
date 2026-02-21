import type { MediaItemRow } from "@/lib/api-client";

export interface VideoFile {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export interface SearchResult {
  video: VideoFile;
  timestamp: number; // seconds
  confidence: number; // 0-1
}

export type SortOption = "score" | "newest" | "shortest-timestamp";
export type SamplingInterval = "2s" | "5s" | "10s";

/** Convert a DB row to the VideoFile shape used by existing components */
export function mediaRowToVideoFile(row: MediaItemRow): VideoFile {
  return {
    filename: row.filename,
    fullPath: row.absolute_path,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.mtime_ms),
  };
}
