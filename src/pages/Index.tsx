import { useState, useMemo, useEffect, useCallback } from "react";
import { MagnifyingGlass, Faders, MapPin, FilmStrip } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { ResultsTable } from "@/components/ResultsTable";
import { MediaDetailSheet } from "@/components/MediaDetailSheet";
import { mockSearch } from "@/lib/mock-data";
import { triggerGeocode, fetchGeocodeStatus, triggerThumbnailGeneration, fetchThumbnailStatus } from "@/lib/api-client";
import { useMediaList, useMediaStats, useMediaExtensions } from "@/hooks/use-media";
import { useQueryClient } from "@tanstack/react-query";
import { useScanDirectory } from "@/hooks/use-scan";
import { mediaRowToVideoFile } from "@/types/video";
import type { MediaItemRow } from "@/lib/api-client";
import type { VideoFile, SearchResult, SortOption } from "@/types/video";

const PAGE_SIZE = 50;

const Index = () => {
  const [availabilityFilter, setAvailabilityFilter] = useState<string | undefined>(undefined);

  const mediaQuery = useMediaList({
    limit: 200,
    availability: availabilityFilter,
    sort: "updated_at",
    order: "desc",
  });
  const statsQuery = useMediaStats();
  const scanMutation = useScanDirectory();

  const videos: VideoFile[] = useMemo(
    () => (mediaQuery.data?.items ?? []).map(mediaRowToVideoFile),
    [mediaQuery.data]
  );
  const totalCount = mediaQuery.data?.total ?? 0;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [mountedOnly, setMountedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [selectedItem, setSelectedItem] = useState<MediaItemRow | null>(null);

  const [dateFilter, setDateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");

  // Browse-mode pagination (server-side)
  const [browsePage, setBrowsePage] = useState(0);
  const extensionsQuery = useMediaExtensions();
  const allExtensions = extensionsQuery.data?.extensions ?? [];

  // Compute mtime_since from dateFilter
  const mtimeSince = useMemo(() => {
    const msMap: Record<string, number> = {
      "7d": 7 * 86400000,
      "30d": 30 * 86400000,
      "90d": 90 * 86400000,
      "1y": 365 * 86400000,
    };
    const cutoff = msMap[dateFilter];
    return cutoff ? String(Date.now() - cutoff) : undefined;
  }, [dateFilter]);

  const browseQuery = useMediaList({
    limit: PAGE_SIZE,
    offset: browsePage * PAGE_SIZE,
    availability: availabilityFilter,
    file_ext: typeFilter !== "all" ? typeFilter : undefined,
    has_gps: locationFilter === "has" ? "true" : locationFilter === "none" ? "false" : undefined,
    mtime_since: mtimeSince,
    sort: "updated_at",
    order: "desc",
  });
  const browseItems = browseQuery.data?.items ?? [];
  const browseTotal = browseQuery.data?.total ?? 0;

  // Geocoding state
  const queryClient = useQueryClient();
  const [geocoding, setGeocoding] = useState(false);
  const [geocodePending, setGeocodePending] = useState(0);

  // Thumbnail generation state
  const [thumbnailGenerating, setThumbnailGenerating] = useState(false);
  const [thumbnailPending, setThumbnailPending] = useState(0);

  // Check geocode + thumbnail status on mount and after scans
  useEffect(() => {
    fetchGeocodeStatus().then((s) => setGeocodePending(s.pending)).catch(() => {});
    fetchThumbnailStatus().then((s) => setThumbnailPending(s.pending + s.queued)).catch(() => {});
  }, [totalCount]);

  const handleGeocode = useCallback(async () => {
    setGeocoding(true);
    try {
      let remaining = Infinity;
      while (remaining > 0) {
        const res = await triggerGeocode();
        remaining = res.remaining;
        setGeocodePending(remaining);
        // Refresh browse data to show new location names
        queryClient.invalidateQueries({ queryKey: ["media"] });
      }
    } catch {
      // stop on error
    } finally {
      setGeocoding(false);
    }
  }, [queryClient]);

  const handleThumbnailGenerate = useCallback(async () => {
    setThumbnailGenerating(true);
    try {
      let remaining = Infinity;
      while (remaining > 0) {
        const res = await triggerThumbnailGeneration();
        remaining = res.remaining;
        setThumbnailPending(remaining);
        queryClient.invalidateQueries({ queryKey: ["media"] });
      }
    } catch {
      // stop on error
    } finally {
      setThumbnailGenerating(false);
    }
  }, [queryClient]);

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
    setResults([]);
    setHasSearched(false);
  };

  // Toggle availability filter when "Only mounted drives" is checked
  const handleMountedToggle = (checked: boolean) => {
    setMountedOnly(checked);
    setAvailabilityFilter(checked ? "online" : undefined);
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    // TODO: Replace with real semantic search API
    const res = mockSearch(query, videos);
    setResults(res);
    setHasSearched(true);
    setVisibleCount(PAGE_SIZE);
  };

  // Unique file extensions from current results
  const fileExtensions = useMemo(() => {
    const exts = new Set<string>();
    for (const r of results) {
      const ext = r.video.filename.split(".").pop()?.toLowerCase();
      if (ext) exts.add(ext);
    }
    return Array.from(exts).sort();
  }, [results]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = results;

    if (typeFilter !== "all") {
      list = list.filter((r) => {
        const ext = r.video.filename.split(".").pop()?.toLowerCase();
        return ext === typeFilter;
      });
    }

    if (locationFilter === "has") {
      list = list.filter((r) => r.video.latitude != null && r.video.longitude != null);
    } else if (locationFilter === "none") {
      list = list.filter((r) => r.video.latitude == null || r.video.longitude == null);
    }

    if (dateFilter !== "all") {
      const now = Date.now();
      const msMap: Record<string, number> = {
        "7d": 7 * 86400000,
        "30d": 30 * 86400000,
        "90d": 90 * 86400000,
        "1y": 365 * 86400000,
      };
      const cutoff = msMap[dateFilter];
      if (cutoff) {
        list = list.filter((r) => now - r.video.modifiedAt.getTime() <= cutoff);
      }
    }

    return list;
  }, [results, typeFilter, locationFilter, dateFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sortBy) {
      case "score":
        return copy.sort((a, b) => b.confidence - a.confidence);
      case "newest":
        return copy.sort(
          (a, b) =>
            b.video.modifiedAt.getTime() - a.video.modifiedAt.getTime()
        );
      case "shortest-timestamp":
        return copy.sort((a, b) => a.timestamp - b.timestamp);
      default:
        return copy;
    }
  }, [filtered, sortBy]);

  const visible = sorted.slice(0, visibleCount);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <VideoSearchSidebar
          onScan={handleScan}
          videoCount={totalCount}
          lastScanTime={scanMutation.isSuccess ? new Date() : null}
          isScanning={scanMutation.isPending}
          stats={statsQuery.data}
        />

        <SidebarInset>
          {/* Header */}
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <SidebarTrigger />
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              Local Video Search
            </h1>
          </header>

          <div className="w-full px-6 py-6 space-y-6">
            {/* Search bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    totalCount > 0
                      ? "Describe what you're looking for…"
                      : "Scan a directory first to search"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  disabled={totalCount === 0}
                />
              </div>
              <Button type="submit" disabled={totalCount === 0}>
                Search
              </Button>
            </form>

            {/* Controls row */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <Faders className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as SortOption)}
                >
                  <SelectTrigger className="w-44 text-xs">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="score">Confidence (high→low)</SelectItem>
                    <SelectItem value="newest">Newest file first</SelectItem>
                    <SelectItem value="shortest-timestamp">
                      Shortest timestamp
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-36 text-xs">
                    <SelectValue placeholder="Date created" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any date</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                    <SelectItem value="1y">Last year</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-32 text-xs">
                    <SelectValue placeholder="File type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {(hasSearched ? fileExtensions : allExtensions).map((ext) => (
                      <SelectItem key={ext} value={ext}>
                        {ext.startsWith(".") ? ext : `.${ext}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-36 text-xs">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any location</SelectItem>
                    <SelectItem value="has">Has GPS</SelectItem>
                    <SelectItem value="none">No GPS</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={mountedOnly}
                  onCheckedChange={(c) => handleMountedToggle(c === true)}
                />
                Only mounted drives
              </label>
            </div>

            {/* Results */}
            {!hasSearched && totalCount === 0 && !mediaQuery.isLoading && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                Enter a directory path in the sidebar and scan for videos to get started.
              </div>
            )}

            {mediaQuery.isLoading && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                Loading media...
              </div>
            )}

            {/* Browse all view */}
            {!hasSearched && totalCount > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {browseTotal.toLocaleString()} file{browseTotal !== 1 ? "s" : ""} indexed
                    {browseTotal > PAGE_SIZE && (
                      <> &middot; Page {browsePage + 1} of {Math.ceil(browseTotal / PAGE_SIZE)}</>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {thumbnailPending > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        disabled={thumbnailGenerating}
                        onClick={handleThumbnailGenerate}
                      >
                        <FilmStrip className="mr-1 h-3 w-3" />
                        {thumbnailGenerating
                          ? `Generating... (${thumbnailPending.toLocaleString()} left)`
                          : `Generate ${thumbnailPending.toLocaleString()} thumbnails`}
                      </Button>
                    )}
                    {geocodePending > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        disabled={geocoding}
                        onClick={handleGeocode}
                      >
                        <MapPin className="mr-1 h-3 w-3" />
                        {geocoding
                          ? `Geocoding... (${geocodePending.toLocaleString()} left)`
                          : `Resolve ${geocodePending.toLocaleString()} locations`}
                      </Button>
                    )}
                  </div>
                </div>
                {browseQuery.isLoading ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Loading...</div>
                ) : (
                  <ResultsTable mode="browse" items={browseItems} onRowClick={setSelectedItem} />
                )}
                {browseTotal > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">
                      {(browsePage * PAGE_SIZE + 1).toLocaleString()}–{Math.min((browsePage + 1) * PAGE_SIZE, browseTotal).toLocaleString()} of {browseTotal.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={browsePage === 0}
                        onClick={() => setBrowsePage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={(browsePage + 1) * PAGE_SIZE >= browseTotal}
                        onClick={() => setBrowsePage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Search results */}
            {hasSearched && results.length === 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                No results found. Try a different query.
              </div>
            )}

            {hasSearched && visible.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {sorted.length} result{sorted.length !== 1 ? "s" : ""}
                    {sorted.length !== results.length && ` (${results.length} before filters)`}
                  </span>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setHasSearched(false); setQuery(""); setResults([]); }}>
                    Back to all
                  </Button>
                </div>
                <ResultsTable mode="search" results={visible} onRowClick={setSelectedItem} />
              </>
            )}

            {hasSearched && sorted.length > visibleCount && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Showing {visibleCount} of {sorted.length} results
                </span>
                <div className="flex gap-2">
                  {visibleCount > PAGE_SIZE && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleCount((c) => Math.max(PAGE_SIZE, c - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((c) => Math.min(sorted.length, c + PAGE_SIZE))}
                  >
                    Next ({Math.min(PAGE_SIZE, sorted.length - visibleCount)} more)
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SidebarInset>

        <MediaDetailSheet
          item={selectedItem}
          open={selectedItem !== null}
          onClose={() => setSelectedItem(null)}
        />
      </div>
    </SidebarProvider>
  );
};

export default Index;
