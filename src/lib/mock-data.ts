import { VideoFile, SearchResult } from "@/types/video";

const MOCK_FILENAMES = [
  "interview_final_cut.mp4",
  "product_demo_v3.mp4",
  "conference_keynote_2024.mp4",
  "behind_the_scenes.mp4",
  "tutorial_react_hooks.mp4",
  "drone_footage_coast.mp4",
  "team_standup_jan15.mp4",
  "client_presentation.mp4",
  "workshop_recording.mp4",
  "timelapse_sunset.mp4",
  "user_testing_session_02.mp4",
  "webinar_ai_tools.mp4",
  "screen_capture_debug.mp4",
  "onboarding_walkthrough.mp4",
  "event_highlight_reel.mp4",
];

/**
 * TODO: Replace with real recursive file system scan.
 * In a desktop app (Electron/Tauri), use fs.readdir or equivalent
 * to recursively find .mp4 files under the given directory.
 */
export function mockScanDirectory(dirPath: string): VideoFile[] {
  const count = 5 + Math.floor(Math.random() * 11); // 5-15 files
  const shuffled = [...MOCK_FILENAMES].sort(() => Math.random() - 0.5);

  return shuffled.slice(0, count).map((filename, i) => ({
    filename,
    fullPath: `${dirPath}/${["projects", "media", "archive", "raw"][i % 4]}/${filename}`,
    sizeBytes: Math.floor(Math.random() * 500_000_000) + 10_000_000,
    modifiedAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
  }));
}

/**
 * TODO: Replace with real semantic search pipeline:
 * 1. Encode query text with CLIP text encoder
 * 2. Query vector DB (LanceDB / FAISS) for nearest frame embeddings
 * 3. Return matched frames with timestamps and similarity scores
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
