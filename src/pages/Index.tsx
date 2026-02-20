import { useState, useMemo } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
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
import { mockScanDirectory, mockSearch } from "@/lib/mock-data";
import type { VideoFile, SearchResult, SortOption } from "@/types/video";

const PAGE_SIZE = 6;

const Index = () => {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [mountedOnly, setMountedOnly] = useState(false); // stub
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const handleScan = (dirPath: string) => {
    setIsScanning(true);
    // Simulate async scan delay
    setTimeout(() => {
      const found = mockScanDirectory(dirPath);
      setVideos(found);
      setLastScanTime(new Date());
      setIsScanning(false);
      setResults([]);
      setHasSearched(false);
    }, 800);
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    /**
     * TODO: Replace mockSearch with real semantic search:
     * 1. Encode `query` with CLIP text encoder
     * 2. Query LanceDB/FAISS for nearest neighbour frame embeddings
     * 3. Map results back to video files + timestamps
     */
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
          videoCount={videos.length}
          lastScanTime={lastScanTime}
          isScanning={isScanning}
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    videos.length > 0
                      ? "Describe what you're looking for…"
                      : "Scan a directory first to search"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  disabled={videos.length === 0}
                />
              </div>
              <Button type="submit" disabled={videos.length === 0}>
                Search
              </Button>
            </form>

            {/* Controls row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
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

              {/* TODO: Implement mounted drive detection for real file system */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={mountedOnly}
                  onCheckedChange={(c) => setMountedOnly(c === true)}
                />
                Only mounted drives
              </label>
            </div>

            {/* Results */}
            {!hasSearched && videos.length === 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                Enter a directory path in the sidebar and scan for videos to get started.
              </div>
            )}

            {!hasSearched && videos.length > 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                {videos.length} video{videos.length !== 1 ? "s" : ""} indexed.
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
