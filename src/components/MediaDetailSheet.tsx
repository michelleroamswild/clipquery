import { useState, useEffect, useMemo } from "react";
import { ArrowSquareOut, ArrowsClockwise, CaretLeft, CaretRight, FilmStrip, Image, MapPin, Brain, Camera, X, Star, Plus, Tag, Folder, Trash } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { thumbnailUrl, streamUrl, openInFinder, generateSingleThumbnail, fetchMediaItem, fetchExifData, reanalyzeSingle } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import { useSetRating } from "@/hooks/use-rating";
import { useSetMarkedForDelete } from "@/hooks/use-mark-delete";
import { useItemTags, useTags, useAddItemTag, useRemoveItemTag } from "@/hooks/use-tags";
import { useCollections, useAddToCollection } from "@/hooks/use-collections";
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

export function MediaDetailSheet({ item: propItem, items, open, onClose, onNavigate }: MediaDetailSheetProps) {
  // Keep the displayed row in sync with the latest list data (query invalidation
  // after e.g. a rating mutation doesn't update the parent's selectedItem state).
  const item = useMemo(() => {
    if (!propItem) return null;
    return items?.find((i) => i.id === propItem.id) ?? propItem;
  }, [propItem, items]);
  const [generating, setGenerating] = useState(false);
  const [generatedThumbUrl, setGeneratedThumbUrl] = useState<string | null>(null);
  const [thumbBroken, setThumbBroken] = useState(false);
  const [lastItemId, setLastItemId] = useState<number | null>(null);
  const [llavaDescription, setLlavaDescription] = useState<string | null>(null);
  const [llavaTags, setLlavaTags] = useState<string[]>([]);
  const [llavaColors, setLlavaColors] = useState<string[]>([]);
  const [llavaVersion, setLlavaVersion] = useState<number>(1);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [exifData, setExifData] = useState<ExifData | null>(null);
  const [errors, setErrors] = useState<{ kind: string; error: string; timestamp: string }[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [collectionPopoverOpen, setCollectionPopoverOpen] = useState(false);

  const setRatingMut = useSetRating();
  const setMarkedMut = useSetMarkedForDelete();
  const itemTags = useItemTags(item?.id);
  const allTags = useTags();
  const addItemTag = useAddItemTag();
  const removeItemTag = useRemoveItemTag();
  const collections = useCollections();
  const addToCollection = useAddToCollection();

  // Reset generated URL and LLaVA data when switching items
  if (item && item.id !== lastItemId) {
    setLastItemId(item.id);
    setGeneratedThumbUrl(null);
    setGenerating(false);
    setThumbBroken(false);
    setLlavaDescription(null);
    setLlavaTags([]);
    setLlavaColors([]);
    setLlavaVersion(1);
    setReanalyzing(false);
    setExifData(null);
    setErrors([]);
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
        // Extract error artifacts
        const errorArtifacts = (detail.artifacts as { kind: string; json?: string }[])
          .filter((a) => a.kind === "llava_error" || a.kind === "thumbnail_error")
          .map((a) => {
            try {
              const data = JSON.parse(a.json ?? "{}") as { error: string; timestamp: string };
              return { kind: a.kind, error: data.error, timestamp: data.timestamp };
            } catch { return null; }
          })
          .filter(Boolean) as { kind: string; error: string; timestamp: string }[];
        setErrors(errorArtifacts);
      })
      .catch(() => {});
    fetchExifData(item.id)
      .then((data) => setExifData(data))
      .catch(() => {});
  }, [item?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation (computed before early return so hooks can reference them)
  const currentIndex = items?.findIndex((i) => i.id === item?.id) ?? -1;
  const hasPrev = currentIndex > 0;
  const hasNext = items != null && currentIndex >= 0 && currentIndex < items.length - 1;

  // Keyboard shortcuts: arrow keys for navigation, 1-5 for rating
  useEffect(() => {
    if (!open || !item) return;
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (hasPrev && items && onNavigate) onNavigate(items[currentIndex - 1]);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hasNext && items && onNavigate) onNavigate(items[currentIndex + 1]);
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setMarkedMut.mutate({ id: item.id, marked: item.marked_for_delete !== 1 });
      } else if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        const rating = parseInt(e.key, 10);
        const next = rating === 1 && item.rating === 1 ? 0 : rating;
        setRatingMut.mutate({ id: item.id, rating: next });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, item, hasPrev, hasNext, currentIndex, items, onNavigate, setRatingMut, setMarkedMut]);

  if (!item) return null;

  const thumbUrl = generatedThumbUrl ?? thumbnailUrl(item);
  const ext = item.file_ext.replace(/^\./, "").toLowerCase();
  const canGenerate = item.type === "video" && item.ai_state !== "done" && !generatedThumbUrl;

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

  type Provenance = "hw" | "ml" | "user" | "sys";
  const meta: { label: string; value: string; source: Provenance; mono?: boolean }[] = [
    { label: "Type", value: item.type, source: "hw" },
    { label: "Size", value: formatFileSize(item.size_bytes), source: "hw", mono: true },
    { label: "Modified", value: new Date(item.mtime_ms).toISOString().replace("T", " ").slice(0, 19), source: "hw", mono: true },
    { label: "Indexed", value: new Date(item.created_at).toISOString().replace("T", " ").slice(0, 19), source: "sys", mono: true },
    ...(item.volume_name ? [{ label: "Volume", value: item.volume_name, source: "hw" as Provenance }] : []),
    { label: "Availability", value: item.availability, source: "sys" },
    { label: "Analysis", value: item.llava_state + (item.llava_version ? ` v${item.llava_version}` : ""), source: "ml" as Provenance, mono: true },
    ...(item.type === "video" ? [{ label: "Thumbnail", value: item.ai_state, source: "sys" as Provenance, mono: true }] : []),
    ...(item.latitude != null && item.longitude != null
      ? [{ label: "GPS", value: formatCoords(item.latitude, item.longitude), source: "hw" as Provenance, mono: true }]
      : []),
    ...(item.location_name ? [{ label: "Location", value: item.location_name, source: "ml" as Provenance }] : []),
  ];

  const ProvTag = ({ source }: { source: Provenance }) => {
    if (source === "sys") return null;
    const labels: Record<Provenance, string> = { hw: "HW", ml: "ML", user: "USER", sys: "" };
    return (
      <span className="provenance-tag mr-1.5 align-middle" data-source={source}>
        {labels[source]}
      </span>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" hideClose className="w-full sm:w-[600px] sm:max-w-[600px] flex flex-col p-0">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate tracking-tight" title={item.filename}>
              {item.filename}
            </h2>
            <span className="inline-block mt-0.5 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
              .{ext}
            </span>
          </div>
          <button
            className="p-0 shrink-0"
            title={item.marked_for_delete === 1 ? "Unmark for delete (D)" : "Mark for delete (D)"}
            onClick={() => setMarkedMut.mutate({ id: item.id, marked: item.marked_for_delete !== 1 })}
          >
            <Trash
              className={`h-4 w-4 ${item.marked_for_delete === 1 ? "text-red-500" : "text-muted-foreground"}`}
              weight={item.marked_for_delete === 1 ? "fill" : "regular"}
            />
          </button>
          <div className="flex items-center shrink-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`Rate ${i} star${i === 1 ? "" : "s"}`}
                className="inline-flex items-center justify-center h-7 w-6 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = i === 1 && item.rating === 1 ? 0 : i;
                  setRatingMut.mutate({ id: item.id, rating: next });
                }}
              >
                <Star
                  className={`h-4 w-4 transition-colors ${i <= item.rating ? "text-foreground" : "text-muted-foreground/30 hover:text-muted-foreground/70"}`}
                  weight={i <= item.rating ? "fill" : "regular"}
                />
              </button>
            ))}
          </div>
          <SheetClose className="rounded-sm opacity-70 hover:opacity-100 transition-opacity shrink-0">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Preview: video player or thumbnail image */}
          {item.type === "video" && item.availability === "online" ? (
            <video
              key={item.id}
              src={streamUrl(item.id)}
              poster={thumbUrl ?? undefined}
              controls
              preload="metadata"
              className="w-full max-h-[400px] bg-black"
            />
          ) : thumbUrl && !thumbBroken ? (
            <img
              src={thumbUrl}
              alt={item.filename}
              onError={() => setThumbBroken(true)}
              className="w-full max-h-[400px] object-contain bg-black"
            />
          ) : (
            <div className="w-full h-[300px] bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
              {item.type === "video" ? <FilmStrip className="h-8 w-8" /> : <Image className="h-8 w-8" />}
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

            {/* Tags section */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                <Tag className="h-3 w-3" />
                Tags
                <span className="provenance-tag" data-source="user">USER</span>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {(itemTags.data ?? []).map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-mono"
                    style={{
                      borderColor: t.color ? `${t.color}66` : undefined,
                      color: t.color || undefined,
                    }}
                  >
                    <span className="provenance-tag" data-source="user">USER</span>
                    {t.name}
                    <button
                      className="ml-0.5 opacity-60 hover:opacity-100"
                      onClick={() => removeItemTag.mutate({ mediaId: item.id, tagId: t.id })}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] rounded-sm">
                      <Plus className="h-3 w-3 mr-0.5" />
                      Add tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="start">
                    <div className="space-y-1">
                      {(allTags.data ?? []).map((t) => (
                        <button
                          key={t.id}
                          className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted flex items-center gap-2"
                          onClick={() => {
                            addItemTag.mutate({ mediaId: item.id, tag: { tagId: t.id } });
                            setTagPopoverOpen(false);
                          }}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: t.color || "#888" }}
                          />
                          {t.name}
                        </button>
                      ))}
                      <div className="border-t border-border pt-1 mt-1">
                        <form
                          className="flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (newTagName.trim()) {
                              addItemTag.mutate({
                                mediaId: item.id,
                                tag: { name: newTagName.trim() },
                              });
                              setNewTagName("");
                              setTagPopoverOpen(false);
                            }
                          }}
                        >
                          <Input
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            placeholder="New tag..."
                            className="h-6 text-xs"
                          />
                          <Button type="submit" size="sm" className="h-6 px-2 text-[11px]">
                            Add
                          </Button>
                        </form>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Collections section */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                <Folder className="h-3 w-3" />
                Collections
                <span className="provenance-tag" data-source="user">USER</span>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {(collections.data ?? [])
                  .filter((c) => c.coverIds?.includes(item.id) || false)
                  .map((c) => (
                    <span
                      key={c.id}
                      className="inline-block rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono"
                    >
                      {c.name}
                    </span>
                  ))}
                <Popover open={collectionPopoverOpen} onOpenChange={setCollectionPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] rounded-sm">
                      <Plus className="h-3 w-3 mr-0.5" />
                      Add to collection
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="start">
                    <div className="space-y-1">
                      {(collections.data ?? []).map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted"
                          onClick={() => {
                            addToCollection.mutate({ collectionId: c.id, mediaIds: [item.id] });
                            setCollectionPopoverOpen(false);
                            toast({ title: "Added", description: `Added to "${c.name}"`, duration: 3000 });
                          }}
                        >
                          {c.name}
                          <span className="text-muted-foreground ml-1">({c.itemCount})</span>
                        </button>
                      ))}
                      {(collections.data ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground px-2 py-1">No collections yet</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {meta.map((m) => (
                <div key={m.label} className="contents">
                  <span className="text-muted-foreground text-[10px] font-mono uppercase tracking-wide whitespace-nowrap pt-0.5">
                    {m.label}
                  </span>
                  <span className={`text-xs flex items-center ${m.mono ? "font-mono" : ""} ${m.source === "ml" ? "text-[hsl(var(--accent-utility))]" : ""}`}>
                    <ProvTag source={m.source} />
                    {m.label === "Location" ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {m.value}
                      </span>
                    ) : (
                      m.value
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <div className="space-y-2">
                {errors.map((err, i) => (
                  <div key={i} className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                    <div className="text-xs font-medium text-red-400">
                      {err.kind === "thumbnail_error" ? "Thumbnail Error" : "Analysis Error"}
                    </div>
                    <p className="text-xs text-red-300/80 mt-1 break-words">{err.error}</p>
                    {err.timestamp && (
                      <p className="text-[10px] text-muted-foreground mt-1">{new Date(err.timestamp).toLocaleString()}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Camera EXIF */}
            {exifData && (exifData.cameraMake || exifData.cameraModel || exifData.lensModel || exifData.fNumber != null) && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                  <Camera className="h-3 w-3" />
                  Camera
                  <span className="provenance-tag" data-source="hw">HW</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs font-mono">
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
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                  <Brain className="h-3 w-3" />
                  Analysis
                  <span className="provenance-tag" data-source="ml">ML v{llavaVersion}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-5 px-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                    disabled={reanalyzing}
                    onClick={handleReanalyze}
                  >
                    <ArrowsClockwise className={`mr-1 h-3 w-3 ${reanalyzing ? "animate-spin" : ""}`} />
                    {reanalyzing ? "RUNNING..." : "RE-ANALYZE"}
                  </Button>
                </div>
                <p className="text-sm leading-relaxed text-[hsl(var(--accent-utility))]">{llavaDescription}</p>
                {llavaTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {llavaTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block rounded-sm border border-[hsl(var(--accent-utility))]/40 px-1.5 py-0.5 text-[11px] font-mono text-[hsl(var(--accent-utility))]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {llavaColors.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {llavaColors.map((color) => (
                      <span
                        key={color}
                        className="inline-block rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground"
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
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Path</span>
              <div className="flex items-start gap-2">
                <code className="flex-1 text-[11px] font-mono bg-muted border border-border px-2 py-1.5 break-all leading-relaxed">
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
