import { useState, useEffect } from "react";
import { ArrowSquareOut, Copy, FilmStrip, Image, MapPin, Brain, X } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { thumbnailUrl, openInFinder, generateSingleThumbnail, fetchMediaItem } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import type { MediaItemRow } from "@/lib/api-client";

interface MediaDetailSheetProps {
  item: MediaItemRow | null;
  open: boolean;
  onClose: () => void;
}

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir}`;
}

export function MediaDetailSheet({ item, open, onClose }: MediaDetailSheetProps) {
  const [generating, setGenerating] = useState(false);
  const [generatedThumbUrl, setGeneratedThumbUrl] = useState<string | null>(null);
  const [lastItemId, setLastItemId] = useState<number | null>(null);
  const [llavaDescription, setLlavaDescription] = useState<string | null>(null);
  const [llavaTags, setLlavaTags] = useState<string[]>([]);

  // Reset generated URL and LLaVA data when switching items
  if (item && item.id !== lastItemId) {
    setLastItemId(item.id);
    setGeneratedThumbUrl(null);
    setGenerating(false);
    setLlavaDescription(null);
    setLlavaTags([]);
  }

  // Fetch LLaVA analysis data from artifacts
  useEffect(() => {
    if (!item || !open) return;
    fetchMediaItem(item.id)
      .then((detail) => {
        const llavaArtifact = (detail.artifacts as { kind: string; json?: string }[])
          .find((a) => a.kind === "llava_analysis");
        if (llavaArtifact?.json) {
          try {
            const data = JSON.parse(llavaArtifact.json) as { description: string; tags: string[] };
            setLlavaDescription(data.description);
            setLlavaTags(data.tags);
          } catch {
            // ignore parse errors
          }
        }
      })
      .catch(() => {});
  }, [item?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const thumbUrl = generatedThumbUrl ?? thumbnailUrl(item);
  const ext = item.file_ext.replace(/^\./, "").toLowerCase();
  const canGenerate = item.type === "video" && item.ai_state !== "done" && !generatedThumbUrl;

  const copyPath = () => {
    navigator.clipboard.writeText(item.absolute_path);
    toast({ title: "Copied", description: "Path copied to clipboard." });
  };

  const handleGenerateThumbnail = async () => {
    setGenerating(true);
    try {
      await generateSingleThumbnail(item.id);
      setGeneratedThumbUrl(`/api/thumbnails/file/${item.id}.jpg?t=${Date.now()}`);
      toast({ title: "Done", description: "Thumbnail generated." });
    } catch {
      toast({ title: "Error", description: "Failed to generate thumbnail." });
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenInFinder = async () => {
    try {
      await openInFinder(item.absolute_path);
    } catch {
      toast({ title: "Error", description: "Failed to open in Finder." });
    }
  };

  const meta: { label: string; value: string }[] = [
    { label: "Type", value: item.type },
    { label: "Size", value: formatFileSize(item.size_bytes) },
    { label: "Date modified", value: new Date(item.mtime_ms).toLocaleString() },
    { label: "Date indexed", value: new Date(item.created_at).toLocaleString() },
    ...(item.volume_name ? [{ label: "Volume", value: item.volume_name }] : []),
    { label: "Availability", value: item.availability },
    { label: "AI state", value: item.ai_state },
    ...(item.latitude != null && item.longitude != null
      ? [{ label: "GPS", value: formatCoords(item.latitude, item.longitude) }]
      : []),
    ...(item.location_name ? [{ label: "Location", value: item.location_name }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" hideClose className="w-[500px] sm:max-w-[500px] overflow-y-auto p-0">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate" title={item.filename}>
              {item.filename}
            </h2>
            <span className="inline-block mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
              .{ext}
            </span>
          </div>
          <SheetClose className="rounded-sm opacity-70 hover:opacity-100 transition-opacity shrink-0">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        {/* Thumbnail */}
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.filename}
            className="w-full aspect-video object-cover"
          />
        ) : (
          <div className="w-full aspect-video bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Image className="h-8 w-8" />
            {canGenerate ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={generating}
                onClick={handleGenerateThumbnail}
              >
                <FilmStrip className="mr-1 h-3 w-3" />
                {generating ? "Generating..." : "Generate thumbnail"}
              </Button>
            ) : (
              <span className="text-xs">Unable to generate preview</span>
            )}
          </div>
        )}

        <div className="p-6 space-y-5">

          {/* Metadata grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {meta.map((m) => (
              <div key={m.label} className="contents">
                <span className="text-muted-foreground text-xs whitespace-nowrap">{m.label}</span>
                <span className="text-xs">
                  {m.label === "Location" ? (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-green-400 shrink-0" />
                      {m.value}
                    </span>
                  ) : (
                    m.value
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* LLaVA Analysis */}
          {llavaDescription && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Brain className="h-3 w-3" />
                AI Analysis
              </div>
              <p className="text-sm leading-relaxed">{llavaDescription}</p>
              {llavaTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {llavaTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Full path */}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Full path</span>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-xs font-mono bg-muted rounded px-2 py-1.5 break-all leading-relaxed">
                {item.absolute_path}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="Copy path"
                onClick={copyPath}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={handleOpenInFinder}>
              <ArrowSquareOut className="mr-1.5 h-3.5 w-3.5" />
              Open in Finder
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={copyPath}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy Path
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
