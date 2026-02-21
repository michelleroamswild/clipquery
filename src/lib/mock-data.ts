import { VideoFile, SearchResult } from "@/types/video";

/**
 * TODO: Replace with real semantic search via POST /api/search
 * once CLIP embeddings and LanceDB are integrated.
 */
export function mockSearch(
  query: string,
  videos: VideoFile[]
): SearchResult[] {
  if (!query.trim() || videos.length === 0) return [];

  // Simulate: return a random subset with random scores
  const numResults = Math.min(
    videos.length,
    2 + Math.floor(Math.random() * (videos.length - 1))
  );
  const shuffled = [...videos].sort(() => Math.random() - 0.5);

  return shuffled.slice(0, numResults).map((video) => ({
    video,
    timestamp: Math.floor(Math.random() * 3600), // 0-60 min
    confidence: Math.round((0.4 + Math.random() * 0.6) * 100) / 100, // 0.40-1.00
  }));
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
