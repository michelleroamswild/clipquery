const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

// --- Types ---

export interface MediaItemRow {
  id: number;
  type: "video" | "photo";
  absolute_path: string;
  filename: string;
  file_ext: string;
  volume_name: string | null;
  volume_id: string | null;
  size_bytes: number;
  mtime_ms: number;
  created_time_ms: number | null;
  content_hash: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  availability: "online" | "offline";
  index_state: "unindexed" | "needs_reindex" | "indexed";
  ai_state: "not_started" | "queued" | "done" | "error";
  llava_state: "not_started" | "queued" | "done" | "error";
  created_at: string;
  updated_at: string;
}

export interface MediaListResponse {
  items: MediaItemRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface VolumeDetail {
  volume_name: string;
  total: number;
  videos: number;
  photos: number;
  lastScan: string | null;
}

export interface MediaStatsResponse {
  total: number;
  byType: { type: string; count: number }[];
  byVolume: { volume_name: string; count: number }[];
  byVolumeDetail: VolumeDetail[];
  byAvailability: { availability: string; count: number }[];
  byIndexState: { index_state: string; count: number }[];
  byAiState: { ai_state: string; count: number }[];
}

export interface ScanResult {
  summaries: { directory: string; filesFound: number; markedOffline: number }[];
  totalInDb: number;
}

export interface MediaDetailResponse {
  item: MediaItemRow;
  artifacts: unknown[];
}

// --- API functions ---

export interface MediaListParams {
  type?: string;
  availability?: string;
  volume?: string;
  file_ext?: string;
  has_gps?: string;
  llava_state?: string;
  mtime_since?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ExtensionsResponse {
  extensions: string[];
}

export function fetchMediaList(params: MediaListParams = {}): Promise<MediaListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const query = qs.toString();
  return request<MediaListResponse>(`/media${query ? `?${query}` : ""}`);
}

export function fetchMediaStats(): Promise<MediaStatsResponse> {
  return request<MediaStatsResponse>("/media/stats");
}

export function fetchMediaExtensions(): Promise<ExtensionsResponse> {
  return request<ExtensionsResponse>("/media/extensions");
}

export function fetchMediaItem(id: number): Promise<MediaDetailResponse> {
  return request<MediaDetailResponse>(`/media/${id}`);
}

export function scanDirectories(directories: string[]): Promise<ScanResult> {
  return request<ScanResult>("/scan", {
    method: "POST",
    body: JSON.stringify({ directories }),
  });
}

export function fetchHealth(): Promise<{ status: string; timestamp: string }> {
  return request("/health");
}

// --- Volumes ---

export interface MountedVolume {
  name: string;
  mountPoint: string;
  uuid: string | null;
}

export interface VolumesResponse {
  volumes: MountedVolume[];
}

export function fetchVolumes(): Promise<VolumesResponse> {
  return request<VolumesResponse>("/volumes");
}

// --- Geocoding ---

export interface GeocodeResult {
  processed: number;
  remaining: number;
}

export interface GeocodeStatus {
  pending: number;
}

export function triggerGeocode(): Promise<GeocodeResult> {
  return request<GeocodeResult>("/geocode", { method: "POST" });
}

export function fetchGeocodeStatus(): Promise<GeocodeStatus> {
  return request<GeocodeStatus>("/geocode/status");
}

export interface GeocodeSearchResult {
  display_name: string;
  lat: number;
  lon: number;
}

export interface GeocodeSearchResponse {
  results: GeocodeSearchResult[];
}

export function searchGeocode(query: string): Promise<GeocodeSearchResponse> {
  return request<GeocodeSearchResponse>(`/geocode/search?q=${encodeURIComponent(query)}`);
}

// --- Thumbnails ---

export interface ThumbnailGenerateResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface ThumbnailStatus {
  pending: number;
  queued: number;
  done: number;
  error: number;
}

export function generateSingleThumbnail(id: number): Promise<{ ok: boolean; ai_state: string }> {
  return request(`/thumbnails/generate/${id}`, { method: "POST" });
}

export function triggerThumbnailGeneration(volume?: string): Promise<ThumbnailGenerateResult> {
  const qs = volume ? `?volume=${encodeURIComponent(volume)}` : "";
  return request<ThumbnailGenerateResult>(`/thumbnails/generate${qs}`, { method: "POST" });
}

export function fetchThumbnailStatus(volume?: string): Promise<ThumbnailStatus> {
  const qs = volume ? `?volume=${encodeURIComponent(volume)}` : "";
  return request<ThumbnailStatus>(`/thumbnails/status${qs}`);
}

/** Build thumbnail URL for a media item, or null if not available */
export function thumbnailUrl(item: { id: number; type: string; ai_state: string }): string | null {
  if (item.type === "photo") return `${BASE}/thumbnails/photo/${item.id}`;
  if (item.type === "video" && item.ai_state === "done") return `${BASE}/thumbnails/file/${item.id}.jpg`;
  return null;
}

// --- Finder ---

export function openInFinder(path: string): Promise<void> {
  return request("/open-in-finder", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

// --- LLaVA ---

export interface LlavaAnalyzeResult {
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface LlavaStatus {
  not_started: number;
  queued: number;
  done: number;
  error: number;
  analyzable: number;
}

export interface OllamaHealth {
  running: boolean;
  model_loaded: boolean;
}

export function triggerLlavaAnalysis(volume?: string): Promise<LlavaAnalyzeResult> {
  const qs = volume ? `?volume=${encodeURIComponent(volume)}` : "";
  return request<LlavaAnalyzeResult>(`/llava/analyze${qs}`, { method: "POST" });
}

export function fetchLlavaStatus(volume?: string): Promise<LlavaStatus> {
  const qs = volume ? `?volume=${encodeURIComponent(volume)}` : "";
  return request<LlavaStatus>(`/llava/status${qs}`);
}

export function fetchOllamaHealth(): Promise<OllamaHealth> {
  return request<OllamaHealth>("/llava/health");
}

// --- LLaVA Background ---

export interface BackgroundStatus {
  running: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
  volume?: string;
  limit?: number;
  startedAt?: number;
}

export function startBackgroundAnalysis(volume?: string, limit?: number): Promise<{ started: boolean; message?: string }> {
  const params = new URLSearchParams();
  if (volume) params.set("volume", volume);
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString() ? `?${params}` : "";
  return request(`/llava/start${qs}`, { method: "POST" });
}

export function stopBackgroundAnalysis(): Promise<BackgroundStatus & { stopped: boolean }> {
  return request(`/llava/stop`, { method: "POST" });
}

export function fetchBackgroundStatus(): Promise<BackgroundStatus> {
  return request<BackgroundStatus>("/llava/background");
}

// --- Dashboard ---

export interface DashboardResponse {
  totals: { count: number; total_size: number };
  byType: { type: string; count: number; size: number }[];
  byLlavaState: { state: string; count: number }[];
  byAiState: { state: string; count: number }[];
  topLocations: { location_name: string; count: number }[];
  timeline: { month: string; count: number }[];
  topExtensions: { file_ext: string; count: number }[];
  volumes: { volume_name: string; count: number; size: number; videos: number; photos: number }[];
  avgSize: { type: string; avg_size: number }[];
  gps: { with_gps: number; without_gps: number };
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return request<DashboardResponse>("/media/dashboard");
}

export interface GpsPoint {
  id: number;
  lat: number;
  lng: number;
  type: string;
  filename: string;
}

export interface GpsPointsResponse {
  points: GpsPoint[];
}

export function fetchGpsPoints(): Promise<GpsPointsResponse> {
  return request<GpsPointsResponse>("/media/gps-points");
}

// --- Folders ---

export interface FolderNode {
  name: string;
  path: string;
  itemCount: number;
  hasChildren: boolean;
}

export interface FoldersResponse {
  folders: FolderNode[];
  rootPath?: string;
  rootItems?: number;
}

export interface FolderLocationUpdateParams {
  folderPath: string;
  locationName: string;
  latitude?: number;
  longitude?: number;
  includeSubfolders?: boolean;
  preserveExistingGps?: boolean;
}

export interface FolderLocationUpdateResponse {
  updated: number;
}

export function fetchFolders(volume: string, parent?: string): Promise<FoldersResponse> {
  const qs = new URLSearchParams({ volume });
  if (parent) qs.set("parent", parent);
  return request<FoldersResponse>(`/folders?${qs}`);
}

export function updateFolderLocation(
  params: FolderLocationUpdateParams
): Promise<FolderLocationUpdateResponse> {
  return request<FolderLocationUpdateResponse>("/folders/location", {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

// --- Search ---

export interface SearchResultItem extends MediaItemRow {
  score: number;
  fts_description: string;
  fts_tags: string;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export function searchMedia(
  q: string,
  limit = 50,
  offset = 0
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  return request<SearchResponse>(`/search?${qs}`);
}
