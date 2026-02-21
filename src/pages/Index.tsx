import { useState, useMemo } from "react";
import { MagnifyingGlass, Faders } from "@phosphor-icons/react";
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
import { VideoResultCard } from "@/components/VideoResultCard";
import { mockSearch } from "@/lib/mock-data";
import { useMediaList, useMediaStats } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import { mediaRowToVideoFile } from "@/types/video";
import type { VideoFile, SearchResult, SortOption } from "@/types/video";

const PAGE_SIZE = 6;

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
  const [results, setResults] = useState<MagnifyingGlassResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [mountedOnly, setMountedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const handleScan = (dirPath: string) => {
    scanMutation.mutate([dirPath], {
      onSuccess: () => {
        setResults([]);
        setHasSearched(false);
      },
    });
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

  const sorted = useMemo(() => {
    const copy = [...results];
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
  }, [results, sortBy]);

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

          <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-6">
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
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
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

            {!hasSearched && totalCount > 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                {totalCount} file{totalCount !== 1 ? "s" : ""} indexed.
                Search for something above.
              </div>
            )}

            {hasSearched && results.length === 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                No results found. Try a different query.
              </div>
            )}

            {visible.length > 0 && (
              <div className="space-y-3">
                {visible.map((r, i) => (
                  <VideoResultCard key={`${r.video.fullPath}-${i}`} result={r} />
                ))}
              </div>
            )}

            {sorted.length > visibleCount && (
              <div className="text-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  Show more ({sorted.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Index;
