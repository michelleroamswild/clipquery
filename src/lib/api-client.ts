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
  llava_version: number;
  rating: number;
  marked_for_delete: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
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
  min_rating?: string;
  tag?: string;
  llava_state?: string;
  llava_version?: string;
  mtime_since?: string;
  orientation?: string;
  marked_for_delete?: string;
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

/** Build stream URL for playing/viewing original media file */
export function streamUrl(id: number): string {
  return `${BASE}/media/${id}/stream`;
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

export function fetchLlavaStatus(volume?: string, type?: string): Promise<LlavaStatus> {
  const params = new URLSearchParams();
  if (volume) params.set("volume", volume);
  if (type) params.set("type", type);
  const qs = params.toString() ? `?${params}` : "";
  return request<LlavaStatus>(`/llava/status${qs}`);
}

export function fetchOllamaHealth(): Promise<OllamaHealth> {
  return request<OllamaHealth>("/llava/health");
}

export function reanalyzeSingle(id: number): Promise<{ ok: boolean; result: unknown }> {
  return request(`/llava/reanalyze/${id}`, { method: "POST" });
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

export function startBackgroundAnalysis(volume?: string, limit?: number, type?: string): Promise<{ started: boolean; message?: string }> {
  const params = new URLSearchParams();
  if (volume) params.set("volume", volume);
  if (limit != null) params.set("limit", String(limit));
  if (type) params.set("type", type);
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
  timeline: { month: string; photos: number; videos: number }[];
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
  hasLocation: boolean;
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

export interface FolderInfo {
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function fetchFolderInfo(folderPath: string): Promise<FolderInfo> {
  return request<FolderInfo>(`/folders/info?path=${encodeURIComponent(folderPath)}`);
}

export function updateFolderLocation(
  params: FolderLocationUpdateParams
): Promise<FolderLocationUpdateResponse> {
  return request<FolderLocationUpdateResponse>("/folders/location", {
    method: "PATCH",
    body: JSON.stringify(params),
  });
}

// --- Storage Helper ---

export interface StorageScanStatus {
  running: boolean;
  processed: number;
  total: number;
  remaining: number;
  startedAt?: number;
}

export interface StorageMediaItem {
  id: number;
  filename: string;
  absolute_path: string;
  type: string;
  file_ext: string;
  size_bytes: number;
  ai_state: string;
  volume_name: string | null;
  mtime_ms: number;
  availability: string;
  llava_state: string;
  llava_version: number;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  duration_sec?: number;
  blur_score?: number;
  phash?: string;
}

export function startStorageScan(): Promise<{ started: boolean; message?: string }> {
  return request("/storage/scan/start", { method: "POST" });
}

export function stopStorageScan(): Promise<StorageScanStatus & { stopped: boolean }> {
  return request("/storage/scan/stop", { method: "POST" });
}

export function fetchStorageScanStatus(): Promise<StorageScanStatus> {
  return request<StorageScanStatus>("/storage/scan/status");
}

export interface StorageFilters {
  volume?: string;
  type?: string;
  file_ext?: string;
}

function storageQs(base: Record<string, string | number>, filters?: StorageFilters): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) qs.set(k, String(v));
  if (filters?.volume) qs.set("volume", filters.volume);
  if (filters?.type) qs.set("type", filters.type);
  if (filters?.file_ext) qs.set("file_ext", filters.file_ext);
  return qs.toString();
}

export function fetchDuplicates(threshold = 10, filters?: StorageFilters): Promise<{ groups: StorageMediaItem[][] }> {
  return request(`/storage/duplicates?${storageQs({ threshold }, filters)}`);
}

export function fetchShortVideos(maxDuration = 1.5, filters?: StorageFilters): Promise<{ items: StorageMediaItem[] }> {
  return request(`/storage/short-videos?${storageQs({ max_duration: maxDuration }, filters)}`);
}

export function fetchBlurry(maxBlur = 100, filters?: StorageFilters): Promise<{ items: StorageMediaItem[] }> {
  return request(`/storage/blurry?${storageQs({ max_blur: maxBlur }, filters)}`);
}

export function fetchLargeFiles(minSize = 500_000_000, limit = 50, filters?: StorageFilters): Promise<{ items: StorageMediaItem[] }> {
  return request(`/storage/large?${storageQs({ min_size: minSize, limit }, filters)}`);
}

export function deleteStorageFiles(ids: number[]): Promise<{ trashed: number; errors: number; freedBytes: number }> {
  return request("/storage/files", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// --- EXIF ---

export interface ExifData {
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  fNumber: number | null;
  exposureTime: number | null;
  focalLength: number | null;
  focalLength35mm: number | null;
  whiteBalance: string | null;
  exposureProgram: string | null;
  flash: string | null;
  dateTimeOriginal: string | null;
}

export function fetchExifData(id: number): Promise<ExifData | null> {
  return request<ExifData | null>(`/media/${id}/exif`, { method: "POST" });
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
  offset = 0,
  minDuration?: number,
  operator?: "and" | "or"
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  if (minDuration != null) qs.set("min_duration", String(minDuration));
  if (operator) qs.set("operator", operator);
  return request<SearchResponse>(`/search?${qs}`);
}

// --- Rating ---

export function setMarkedForDelete(id: number, marked: boolean): Promise<{ marked: boolean }> {
  return request(`/media/${id}/mark-delete`, {
    method: "POST",
    body: JSON.stringify({ marked }),
  });
}

export function setRating(id: number, rating: number): Promise<{ rating: number }> {
  return request(`/media/${id}/rating`, {
    method: "POST",
    body: JSON.stringify({ rating }),
  });
}

// --- Tags ---

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  count?: number;
}

export interface TagsResponse {
  tags: Tag[];
}

export function fetchTags(): Promise<TagsResponse> {
  return request<TagsResponse>("/tags");
}

export function createTag(name: string, color?: string): Promise<Tag> {
  return request<Tag>("/tags", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
}

export function deleteTag(id: number): Promise<{ ok: boolean }> {
  return request(`/tags/${id}`, { method: "DELETE" });
}

export function fetchItemTags(mediaId: number): Promise<TagsResponse> {
  return request<TagsResponse>(`/media/${mediaId}/tags`);
}

export function addItemTag(
  mediaId: number,
  tag: { tagId?: number; name?: string; color?: string }
): Promise<TagsResponse> {
  return request<TagsResponse>(`/media/${mediaId}/tags`, {
    method: "POST",
    body: JSON.stringify(tag),
  });
}

export function removeItemTag(mediaId: number, tagId: number): Promise<{ ok: boolean }> {
  return request(`/media/${mediaId}/tags/${tagId}`, { method: "DELETE" });
}

export function bulkAddTag(
  tagId: number,
  mediaIds: number[]
): Promise<{ ok: boolean; count: number }> {
  return request("/tags/bulk", {
    method: "POST",
    body: JSON.stringify({ tagId, mediaIds }),
  });
}

// --- Collections ---

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  itemCount: number;
  coverIds: number[];
  created_at: string;
  updated_at: string;
}

export interface CollectionsResponse {
  collections: Collection[];
}

export interface CollectionDetail {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  items: (MediaItemRow & { position: number; collection_added_at: string })[];
}

export function fetchCollections(): Promise<CollectionsResponse> {
  return request<CollectionsResponse>("/collections");
}

export function createCollection(
  name: string,
  description?: string
): Promise<Collection> {
  return request<Collection>("/collections", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export function updateCollection(
  id: number,
  data: { name?: string; description?: string }
): Promise<Collection> {
  return request<Collection>(`/collections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCollection(id: number): Promise<{ ok: boolean }> {
  return request(`/collections/${id}`, { method: "DELETE" });
}

export function fetchCollectionDetail(id: number): Promise<CollectionDetail> {
  return request<CollectionDetail>(`/collections/${id}`);
}

export function addToCollection(
  collectionId: number,
  mediaIds: number[]
): Promise<{ ok: boolean }> {
  return request(`/collections/${collectionId}/items`, {
    method: "POST",
    body: JSON.stringify({ mediaIds }),
  });
}

export function removeFromCollection(
  collectionId: number,
  mediaId: number
): Promise<{ ok: boolean }> {
  return request(`/collections/${collectionId}/items/${mediaId}`, {
    method: "DELETE",
  });
}

export function reorderCollectionItems(
  collectionId: number,
  orderedIds: number[]
): Promise<{ ok: boolean }> {
  return request(`/collections/${collectionId}/items/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ orderedIds }),
  });
}
