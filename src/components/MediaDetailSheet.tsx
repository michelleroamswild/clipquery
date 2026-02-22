import { useState, useEffect } from "react";
import { ArrowSquareOut, ArrowsClockwise, CaretLeft, CaretRight, FilmStrip, Image, MapPin, Brain, Camera, X } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { thumbnailUrl, openInFinder, generateSingleThumbnail, fetchMediaItem, fetchExifData, reanalyzeSingle } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import type { MediaItemRow, ExifData } from "@/lib/api-client";

interface MediaDetailSheetProps {
  item: MediaItemRow | null;
  items?: MediaItemRow[];
  open: boolean;
  onClose: () => void;
  onNavigate?: (item: MediaItemRow) => void;
}

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir}`;
}

export function MediaDetailSheet({ item, items, open, onClose, onNavigate }: MediaDetailSheetProps) {
  const [generating, setGenerating] = useState(false);
  const [generatedThumbUrl, setGeneratedThumbUrl] = useState<string | null>(null);
  const [lastItemId, setLastItemId] = useState<number | null>(null);
  const [llavaDescription, setLlavaDescription] = useState<string | null>(null);
  const [llavaTags, setLlavaTags] = useState<string[]>([]);
  const [llavaColors, setLlavaColors] = useState<string[]>([]);
  const [llavaVersion, setLlavaVersion] = useState<number>(1);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [exifData, setExifData] = useState<ExifData | null>(null);

  // Reset generated URL and LLaVA data when switching items
  if (item && item.id !== lastItemId) {
    setLastItemId(item.id);
    setGeneratedThumbUrl(null);
    setGenerating(false);
    setLlavaDescription(null);
    setLlavaTags([]);
    setLlavaColors([]);
    setLlavaVersion(1);
    setReanalyzing(false);
    setExifData(null);
  }

  // Fetch LLaVA analysis data from artifacts and EXIF data
  useEffect(() => {
    if (!item || !open) return;
    fetchMediaItem(item.id)
      .then((detail) => {
        const llavaArtifact = (detail.artifacts as { kind: string; json?: string }[])
          .find((a) => a.kind === "llava_analysis");
        if (llavaArtifact?.json) {
          try {
            const data = JSON.parse(llavaArtifact.json) as { description: string; tags: string[]; colors?: string[]; version?: number };
            setLlavaDescription(data.description);
            setLlavaTags(data.tags);
            setLlavaColors(data.colors ?? []);
            setLlavaVersion(data.version ?? 1);
          } catch {
            // ignore parse errors
          }
        }
      })
      .catch(() => {});
    fetchExifData(item.id)
      .then((data) => setExifData(data))
      .catch(() => {});
  }, [item?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const thumbUrl = generatedThumbUrl ?? thumbnailUrl(item);
  const ext = item.file_ext.replace(/^\./, "").toLowerCase();
  const canGenerate = item.type === "video" && item.ai_state !== "done" && !generatedThumbUrl;

  // Navigation
  const currentIndex = items?.findIndex((i) => i.id === item.id) ?? -1;
  const hasPrev = currentIndex > 0;
  const hasNext = items != null && currentIndex >= 0 && currentIndex < items.length - 1;
  const goPrev = () => {
    if (hasPrev && items && onNavigate) onNavigate(items[currentIndex - 1]);
  };
  const goNext = () => {
    if (hasNext && items && onNavigate) onNavigate(items[currentIndex + 1]);
  };

  const handleGenerateThumbnail = async () => {
    setGenerating(true);
    try {
      await generateSingleThumbnail(item.id);
      setGeneratedThumbUrl(`/api/thumbnails/file/${item.id}.jpg?t=${Date.now()}`);
      toast({ title: "Done", description: "Thumbnail generated.", duration: 5000 });
    } catch {
      toast({ title: "Error", description: "Failed to generate thumbnail.", duration: 5000 });
    } finally {
      setGenerating(false);
    }
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const { result } = await reanalyzeSingle(item.id);
      const data = result as { description: string; tags: string[]; colors?: string[]; version?: number };
      setLlavaDescription(data.description);
      setLlavaTags(data.tags);
      setLlavaColors(data.colors ?? []);
      setLlavaVersion(data.version ?? 2);
      toast({ title: "Done", description: "Re-analysis complete.", duration: 5000 });
    } catch {
      toast({ title: "Error", description: "Re-analysis failed. Is Ollama running?", duration: 5000 });
    } finally {
      setReanalyzing(false);
    }
  };

  const handleOpenInFinder = async () => {
    try {
      await openInFinder(item.absolute_path);
    } catch {
      toast({ title: "Error", description: "Failed to open in Finder.", duration: 5000 });
    }
  };

  const meta: { label: string; value: string }[] = [
    { label: "Type", value: item.type },
    { label: "Size", value: formatFileSize(item.size_bytes) },
    { label: "Date modified", value: new Date(item.mtime_ms).toLocaleString() },
    { label: "Date indexed", value: new Date(item.created_at).toLocaleString() },
    ...(item.volume_name ? [{ label: "Volume", value: item.volume_name }] : []),
    { label: "Availability", value: item.availability },
    { label: "AI Analysis", value: item.llava_state + (item.llava_version ? ` (v${item.llava_version})` : "") },
    ...(item.type === "video" ? [{ label: "Poster Frame", value: item.ai_state }] : []),
    ...(item.latitude != null && item.longitude != null
      ? [{ label: "GPS", value: formatCoords(item.latitude, item.longitude) }]
      : []),
    ...(item.location_name ? [{ label: "Location", value: item.location_name }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" hideClose className="w-[600px] sm:max-w-[600px] flex flex-col p-0">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Thumbnail */}
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={item.filename}
              className="w-full max-h-[400px] object-contain bg-black"
            />
          ) : (
            <div className="w-full h-[300px] bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
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

          {/* Prev / Next navigation */}
          {items && items.length > 1 && (
            <div className="flex items-center justify-between px-5 py-2 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                disabled={!hasPrev}
                onClick={goPrev}
              >
                <CaretLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {items.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
                disabled={!hasNext}
                onClick={goNext}
              >
                Next
                <CaretRight className="h-4 w-4" />
              </Button>
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

            {/* Camera EXIF */}
            {exifData && (exifData.cameraMake || exifData.cameraModel || exifData.lensModel || exifData.fNumber != null) && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Camera className="h-3 w-3" />
                  Camera
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                  {(exifData.cameraMake || exifData.cameraModel) && (
                    <div className="contents">
                      <span className="text-muted-foreground">Camera</span>
                      <span>{[exifData.cameraMake, exifData.cameraModel].filter(Boolean).join(" ")}</span>
                    </div>
                  )}
                  {exifData.lensModel && (
                    <div className="contents">
                      <span className="text-muted-foreground">Lens</span>
                      <span>{exifData.lensModel}</span>
                    </div>
                  )}
                  {(exifData.fNumber != null || exifData.exposureTime != null || exifData.iso != null || exifData.focalLength != null) && (
                    <div className="contents">
                      <span className="text-muted-foreground">Settings</span>
                      <span>
                        {[
                          exifData.fNumber != null ? `f/${exifData.fNumber}` : null,
                          exifData.exposureTime != null
                            ? exifData.exposureTime >= 1
                              ? `${exifData.exposureTime}s`
                              : `1/${Math.round(1 / exifData.exposureTime)}s`
                            : null,
                          exifData.iso != null ? `ISO ${exifData.iso}` : null,
                          exifData.focalLength != null ? `${exifData.focalLength}mm` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  )}
                  {exifData.dateTimeOriginal && (
                    <div className="contents">
                      <span className="text-muted-foreground">Taken</span>
                      <span>{new Date(exifData.dateTimeOriginal).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LLaVA Analysis */}
            {llavaDescription && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Brain className="h-3 w-3" />
                  AI Analysis
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    llavaVersion >= 2
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    v{llavaVersion}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                    disabled={reanalyzing}
                    onClick={handleReanalyze}
                  >
                    <ArrowsClockwise className={`mr-1 h-3 w-3 ${reanalyzing ? "animate-spin" : ""}`} />
                    {reanalyzing ? "Analyzing..." : "Re-analyze"}
                  </Button>
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
                {llavaColors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {llavaColors.map((color) => (
                      <span
                        key={color}
                        className="inline-block rounded-full bg-violet-500/10 text-violet-300 px-2 py-0.5 text-xs"
                      >
                        {color}
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
              </div>
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t border-border px-5 py-3">
          <Button variant="outline" className="w-full" onClick={handleOpenInFinder}>
            <ArrowSquareOut className="mr-2 h-4 w-4" />
            Open in Finder
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
