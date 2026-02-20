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
  /** TODO: Add embedding vector and matched frame data when CLIP integration is added */
}

export type SortOption = "score" | "newest" | "shortest-timestamp";
export type SamplingInterval = "2s" | "5s" | "10s";
