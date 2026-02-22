import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { MagnifyingGlass, Faders, MapPin, FilmStrip, CaretDown, Brain, Stop, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { ResultsTable } from "@/components/ResultsTable";
import { MediaDetailSheet } from "@/components/MediaDetailSheet";
import { mockSearch } from "@/lib/mock-data";
import { triggerGeocode, fetchGeocodeStatus, triggerThumbnailGeneration, fetchThumbnailStatus, fetchLlavaStatus, fetchOllamaHealth, searchMedia, startBackgroundAnalysis, stopBackgroundAnalysis, fetchBackgroundStatus } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [selectedItem, setSelectedItem] = useState<MediaItemRow | null>(null);

  const [dateFilter, setDateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [volumeFilter, setVolumeFilter] = useState("all");
  const [aiFilter, setAiFilter] = useState("all");

  // Browse-mode sort & pagination (server-side)
  const [browseSort, setBrowseSort] = useState("mtime_ms");
  const [browseOrder, setBrowseOrder] = useState<"asc" | "desc">("desc");
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
    volume: volumeFilter !== "all" ? volumeFilter : undefined,
    file_ext: typeFilter !== "all" ? typeFilter : undefined,
    has_gps: locationFilter === "has" ? "true" : locationFilter === "none" ? "false" : undefined,
    llava_state: aiFilter === "v1" || aiFilter === "v2" ? "done" : aiFilter !== "all" ? aiFilter : undefined,
    llava_version: aiFilter === "v1" ? "1" : aiFilter === "v2" ? "2" : undefined,
    mtime_since: mtimeSince,
    sort: browseSort,
    order: browseOrder,
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

  // LLaVA analysis state
  const [llavaAnalyzing, setLlavaAnalyzing] = useState(false);
  const [llavaAnalyzable, setLlavaAnalyzable] = useState(0);
  const [ollamaHealthy, setOllamaHealthy] = useState(false);
  const llavaAbortRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check geocode + thumbnail + llava status on mount, after scans, and when volume filter changes
  useEffect(() => {
    fetchGeocodeStatus().then((s) => setGeocodePending(s.pending)).catch(() => {});
    const vol = volumeFilter !== "all" ? volumeFilter : undefined;
    fetchThumbnailStatus(vol).then((s) => setThumbnailPending(s.pending + s.queued + s.error)).catch(() => {});
    fetchLlavaStatus(vol).then((s) => setLlavaAnalyzable(s.analyzable + s.queued)).catch(() => {});
    fetchOllamaHealth().then((h) => setOllamaHealthy(h.running && h.model_loaded)).catch(() => setOllamaHealthy(false));
    // Resume UI state if background analysis is already running
    fetchBackgroundStatus().then((bg) => {
      if (bg.running && !llavaAbortRef.current) {
        setLlavaAnalyzing(true);
        const t = toast({ title: "AI Analysis", description: `${bg.processed} done, ${bg.remaining.toLocaleString()} remaining` });
        const poll = setInterval(async () => {
          try {
            const s = await fetchBackgroundStatus();
            setLlavaAnalyzable(s.remaining);
            if (s.running) {
              t.update({ title: "AI Analysis", description: `${s.processed} done, ${s.remaining.toLocaleString()} remaining` });
              queryClient.invalidateQueries({ queryKey: ["media"] });
            } else {
              clearInterval(poll);
              setLlavaAnalyzing(false);
              queryClient.invalidateQueries({ queryKey: ["media"] });
              t.update({ title: "AI Analysis complete", description: `${s.succeeded} succeeded${s.failed > 0 ? `, ${s.failed} failed` : ""}` });
              setTimeout(() => t.dismiss(), 5000);
            }
          } catch {
            clearInterval(poll);
            setLlavaAnalyzing(false);
          }
        }, 3000);
        llavaAbortRef.current = poll;
      }
    }).catch(() => {});
  }, [totalCount, volumeFilter]);

  const handleGeocode = useCallback(async () => {
    setGeocoding(true);
    let total = 0;
    const t = toast({ title: "Geocoding", description: "Starting..." });
    try {
      let remaining = Infinity;
      while (remaining > 0) {
        const res = await triggerGeocode();
        remaining = res.remaining;
        total += res.processed;
        setGeocodePending(remaining);
        t.update({ title: "Geocoding", description: `${total} done, ${remaining} remaining` });
        queryClient.invalidateQueries({ queryKey: ["media"] });
      }
      t.update({ title: "Geocoding complete", description: `${total} locations resolved` });
      setTimeout(() => t.dismiss(), 5000);
    } catch {
      t.update({ title: "Geocoding stopped", description: `${total} done` });
      setTimeout(() => t.dismiss(), 5000);
    } finally {
      setGeocoding(false);
    }
  }, [queryClient]);

  const handleThumbnailGenerate = useCallback(async (limit?: number) => {
    setThumbnailGenerating(true);
    const vol = volumeFilter !== "all" ? volumeFilter : undefined;
    let processed = 0;
    const target = limit != null ? ` of ${limit}` : "";
    const t = toast({ title: "Generating thumbnails", description: "Starting..." });
    try {
      let remaining = Infinity;
      while (remaining > 0 && (limit == null || processed < limit)) {
        const res = await triggerThumbnailGeneration(vol);
        remaining = res.remaining;
        processed += res.processed;
        setThumbnailPending(remaining);
        t.update({ title: "Generating thumbnails", description: `${processed}${target} done, ${remaining} remaining` });
        queryClient.invalidateQueries({ queryKey: ["media"] });
        if (res.processed === 0) break;
      }
      t.update({ title: "Thumbnails complete", description: `${processed} generated` });
      setTimeout(() => t.dismiss(), 5000);
    } catch {
      t.update({ title: "Thumbnails stopped", description: `${processed}${target} done` });
      setTimeout(() => t.dismiss(), 5000);
    } finally {
      setThumbnailGenerating(false);
    }
  }, [queryClient, volumeFilter]);

  // Start background analysis on the server
  const handleLlavaAnalyze = useCallback(async (limit?: number) => {
    const vol = volumeFilter !== "all" ? volumeFilter : undefined;
    const res = await startBackgroundAnalysis(vol, limit);
    if (!res.started) {
      toast({ title: "AI Analysis", description: "Already running", duration: 5000 });
      return;
    }
    setLlavaAnalyzing(true);
    const target = limit != null ? ` of ${limit}` : "";
    const t = toast({ title: "AI Analysis", description: "Starting..." });

    // Poll server for progress
    const poll = setInterval(async () => {
      try {
        const bg = await fetchBackgroundStatus();
        setLlavaAnalyzable(bg.remaining);
        if (bg.running) {
          t.update({ title: "AI Analysis", description: `${bg.processed}${target} done, ${bg.remaining.toLocaleString()} remaining` });
          queryClient.invalidateQueries({ queryKey: ["media"] });
        } else {
          clearInterval(poll);
          setLlavaAnalyzing(false);
          queryClient.invalidateQueries({ queryKey: ["media"] });
          t.update({ title: "AI Analysis complete", description: `${bg.succeeded} succeeded${bg.failed > 0 ? `, ${bg.failed} failed` : ""}` });
          setTimeout(() => t.dismiss(), 5000);
        }
      } catch {
        clearInterval(poll);
        setLlavaAnalyzing(false);
      }
    }, 3000);
    llavaAbortRef.current = poll;
  }, [queryClient, volumeFilter]);

  // Stop background analysis on the server
  const handleLlavaStop = useCallback(async () => {
    if (llavaAbortRef.current) clearInterval(llavaAbortRef.current);
    await stopBackgroundAnalysis();
    setLlavaAnalyzing(false);
    toast({ title: "AI Analysis", description: "Stopping after current item..." });
  }, []);

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
    setResults([]);
    setHasSearched(false);
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      const res = await searchMedia(query.trim(), 200);
      // Convert FTS results to SearchResult format
      const searchResults: SearchResult[] = res.items.map((item) => ({
        video: mediaRowToVideoFile(item),
        mediaItem: item,
        timestamp: 0,
        confidence: Math.abs(item.score),
      }));
      setResults(searchResults);
    } catch {
      // Fallback to mock search if FTS fails
      const res = mockSearch(query, videos);
      setResults(res);
    }
    setHasSearched(true);
    setVisibleCount(PAGE_SIZE);
    setTypeFilter("all");
    setDateFilter("all");
    setLocationFilter("all");
    setAiFilter("all");
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
                  className="pl-9 pr-8"
                  disabled={totalCount === 0}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => { setQuery(""); setResults([]); setHasSearched(false); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="submit" disabled={totalCount === 0}>
                Search
              </Button>
            </form>

            {/* Controls row */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <Faders className="h-4 w-4 text-muted-foreground" />
                {hasSearched ? (
                  <Select
                    value={sortBy}
                    onValueChange={(v) => setSortBy(v as SortOption)}
                  >
                    <SelectTrigger className="w-44 text-xs">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="score">Confidence (high-low)</SelectItem>
                      <SelectItem value="newest">Newest file first</SelectItem>
                      <SelectItem value="shortest-timestamp">Shortest timestamp</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={`${browseSort}:${browseOrder}`}
                    onValueChange={(v) => {
                      const [col, dir] = v.split(":") as [string, "asc" | "desc"];
                      setBrowseSort(col);
                      setBrowseOrder(dir);
                      setBrowsePage(0);
                    }}
                  >
                    <SelectTrigger className="w-44 text-xs">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mtime_ms:desc">Newest first</SelectItem>
                      <SelectItem value="mtime_ms:asc">Oldest first</SelectItem>
                      <SelectItem value="filename:asc">Name (A-Z)</SelectItem>
                      <SelectItem value="filename:desc">Name (Z-A)</SelectItem>
                      <SelectItem value="size_bytes:desc">Largest first</SelectItem>
                      <SelectItem value="size_bytes:asc">Smallest first</SelectItem>
                    </SelectContent>
                  </Select>
                )}

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

                <Select value={volumeFilter} onValueChange={(v) => { setVolumeFilter(v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-40 text-xs">
                    <SelectValue placeholder="Volume" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All drives</SelectItem>
                    {(statsQuery.data?.byVolume ?? []).map((v) => (
                      <SelectItem key={v.volume_name} value={v.volume_name}>
                        {v.volume_name} ({v.count.toLocaleString()})
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

                <Select value={availabilityFilter ?? "all"} onValueChange={(v) => { setAvailabilityFilter(v === "all" ? undefined : v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-32 text-xs">
                    <SelectValue placeholder="Availability" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any status</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={aiFilter} onValueChange={(v) => { setAiFilter(v); setVisibleCount(PAGE_SIZE); setBrowsePage(0); }}>
                  <SelectTrigger className="w-36 text-xs">
                    <SelectValue placeholder="AI status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any AI status</SelectItem>
                    <SelectItem value="done">Analyzed (all)</SelectItem>
                    <SelectItem value="v2">Analyzed v2</SelectItem>
                    <SelectItem value="v1">Analyzed v1</SelectItem>
                    <SelectItem value="not_started">Not analyzed</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>

                {(dateFilter !== "all" || typeFilter !== "all" || volumeFilter !== "all" || locationFilter !== "all" || aiFilter !== "all" || availabilityFilter != null) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => {
                      setDateFilter("all");
                      setTypeFilter("all");
                      setVolumeFilter("all");
                      setLocationFilter("all");
                      setAiFilter("all");
                      setAvailabilityFilter(undefined);
                      setVisibleCount(PAGE_SIZE);
                      setBrowsePage(0);
                    }}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Clear filters
                  </Button>
                )}
              </div>

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
                      <div className="flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs rounded-r-none border-r-0"
                          disabled={thumbnailGenerating}
                          onClick={() => handleThumbnailGenerate(100)}
                        >
                          <FilmStrip className="mr-1 h-3 w-3" />
                          {thumbnailGenerating
                            ? `Generating... (${thumbnailPending.toLocaleString()} left)`
                            : `Generate thumbnails (${thumbnailPending.toLocaleString()})`}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs rounded-l-none px-1.5"
                              disabled={thumbnailGenerating}
                            >
                              <CaretDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleThumbnailGenerate(50)}>Generate 50</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleThumbnailGenerate(100)}>Generate 100</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleThumbnailGenerate(500)}>Generate 500</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleThumbnailGenerate()}>Generate all</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                    {ollamaHealthy && (llavaAnalyzable > 0 || llavaAnalyzing) && (
                      <div className="flex items-center">
                        {llavaAnalyzing ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={handleLlavaStop}
                          >
                            <Stop className="mr-1 h-3 w-3" weight="fill" />
                            Stop ({llavaAnalyzable.toLocaleString()} left)
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs rounded-r-none border-r-0"
                              onClick={() => handleLlavaAnalyze(20)}
                            >
                              <Brain className="mr-1 h-3 w-3" />
                              AI Analyze ({llavaAnalyzable.toLocaleString()})
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs rounded-l-none px-1.5"
                                >
                                  <CaretDown className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleLlavaAnalyze(20)}>Analyze 20</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleLlavaAnalyze(50)}>Analyze 50</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleLlavaAnalyze(100)}>Analyze 100</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleLlavaAnalyze()}>Analyze all</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
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
          items={hasSearched ? visible.map((r) => r.mediaItem!).filter(Boolean) : browseItems}
          open={selectedItem !== null}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
        />
      </div>
    </SidebarProvider>
  );
};

export default Index;
