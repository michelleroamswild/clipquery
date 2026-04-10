import { useState, useCallback } from "react";
import { FilmStrip, MagnifyingGlass, SpinnerGap, Clock, TextT } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { ResultsTable } from "@/components/ResultsTable";
import { MediaDetailSheet } from "@/components/MediaDetailSheet";
import { parseClipDescriptions, type ParsedClip } from "@/lib/clip-parser";
import { searchMedia, type SearchResultItem, type MediaItemRow } from "@/lib/api-client";
import { useMediaStats } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import { mediaRowToVideoFile } from "@/types/video";
import type { SearchResult } from "@/types/video";

interface ClipResult {
  clip: ParsedClip;
  results: SearchResult[];
  matchCounts: number[];  // keyword match count per result
  totalKeywords: number;
  loading: boolean;
  error: string | null;
}

/** Count how many of the search keywords appear in the result's description + tags */
function countKeywordMatches(keywords: string[], item: SearchResultItem): number {
  const text = `${item.fts_description ?? ""} ${item.fts_tags ?? ""}`.toLowerCase();
  return keywords.filter((kw) => text.includes(kw)).length;
}

const ClipFinder = () => {
  const [input, setInput] = useState("");
  const [clipResults, setClipResults] = useState<ClipResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItemRow | null>(null);

  const { data: stats } = useMediaStats();
  const scanMutation = useScanDirectory();

  const handleFindClips = useCallback(async () => {
    const clips = parseClipDescriptions(input);
    if (clips.length === 0) return;

    const initial: ClipResult[] = clips.map((clip) => ({
      clip,
      results: [],
      matchCounts: [],
      totalKeywords: clip.searchQuery.split(/\s+/).filter(Boolean).length,
      loading: true,
      error: null,
    }));
    setClipResults(initial);
    setSearching(true);

    const settled = await Promise.allSettled(
      clips.map((clip) =>
        searchMedia(clip.searchQuery, 50, 0, clip.durationSec > 0 ? clip.durationSec : undefined, "or")
      )
    );

    setClipResults(
      clips.map((clip, i) => {
        const result = settled[i];
        const keywords = clip.searchQuery.split(/\s+/).filter(Boolean);
        if (result.status === "fulfilled") {
          const items = result.value.items;
          const matchCounts = items.map((item) => countKeywordMatches(keywords, item));
          // Sort by match count descending (best matches first)
          const indices = items.map((_, idx) => idx);
          indices.sort((a, b) => matchCounts[b] - matchCounts[a]);

          return {
            clip,
            results: indices.map((idx) => ({
              video: mediaRowToVideoFile(items[idx]),
              mediaItem: items[idx],
              timestamp: 0,
              confidence: keywords.length > 0 ? matchCounts[idx] / keywords.length : 0,
            })),
            matchCounts: indices.map((idx) => matchCounts[idx]),
            totalKeywords: keywords.length,
            loading: false,
            error: null,
          };
        }
        return {
          clip,
          results: [],
          matchCounts: [],
          totalKeywords: keywords.length,
          loading: false,
          error: result.reason?.message ?? "Search failed",
        };
      })
    );
    setSearching(false);
  }, [input]);

  return (
    <SidebarProvider>
      <VideoSearchSidebar
        onScan={async (dir) => { await scanMutation.mutateAsync([dir]); }}
        videoCount={stats?.total ?? 0}
        lastScanTime={null}
        isScanning={scanMutation.isPending}
        stats={stats}
      />
      <SidebarInset>
        <div className="flex flex-col h-full">
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <SidebarTrigger />
            <FilmStrip className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Clip Finder</h1>
          </header>

          <div className="p-4 space-y-4 flex-1 overflow-auto">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Paste multi-clip descriptions
              </label>
              <Textarea
                placeholder={`Clip 1: A ~11.1s clip that feels peaceful...\nClip 2: A ~5.3s clip with energetic movement...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
              <Button
                onClick={handleFindClips}
                disabled={searching || !input.trim()}
              >
                {searching ? (
                  <SpinnerGap className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MagnifyingGlass className="h-4 w-4 mr-2" />
                )}
                Find Clips
              </Button>
            </div>

            {clipResults.map((cr) => (
              <div key={cr.clip.clipNumber} className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-sm font-semibold">{cr.clip.label}</h2>
                  {cr.clip.durationSec > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      <Clock className="h-3 w-3" />
                      {cr.clip.durationSec}s min
                    </span>
                  )}
                  {cr.clip.overlayText && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      <TextT className="h-3 w-3" />
                      "{cr.clip.overlayText}"
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Search: {cr.clip.searchQuery}
                  </span>
                </div>

                {cr.loading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <SpinnerGap className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}

                {cr.error && (
                  <p className="text-sm text-destructive py-2">{cr.error}</p>
                )}

                {!cr.loading && !cr.error && cr.results.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4">
                    No matches found
                  </p>
                )}

                {!cr.loading && cr.results.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {cr.results.length} result{cr.results.length !== 1 ? "s" : ""} — best match: {cr.matchCounts[0]}/{cr.totalKeywords} keywords
                  </p>
                )}

                {!cr.loading && cr.results.length > 0 && (
                  <ResultsTable
                    mode="search"
                    results={cr.results}
                    onRowClick={(item) => setSelectedItem(item)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <MediaDetailSheet
          item={selectedItem}
          open={selectedItem !== null}
          onClose={() => setSelectedItem(null)}
        />
      </SidebarInset>
    </SidebarProvider>
  );
};

export default ClipFinder;
