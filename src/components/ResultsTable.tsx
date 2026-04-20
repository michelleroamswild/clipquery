import { useState } from "react";
import { ArrowSquareOut, Brain, Star, Image, FilmStrip, MapPin, Plus, Warning, WifiHigh, WifiSlash, Trash } from "@phosphor-icons/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { openInFinder, thumbnailUrl } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import { useSetRating } from "@/hooks/use-rating";
import { useCollections, useAddToCollection } from "@/hooks/use-collections";
import type { MediaItemRow, Collection } from "@/lib/api-client";
import type { SearchResult } from "@/types/video";

interface SearchTableProps {
  mode: "search";
  results: SearchResult[];
  onRowClick?: (item: MediaItemRow) => void;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
}

interface BrowseTableProps {
  mode: "browse";
  items: MediaItemRow[];
  onRowClick?: (item: MediaItemRow) => void;
  selectable?: boolean;
  selectedIds?: Set<number>;
  onSelectionChange?: (ids: Set<number>) => void;
}

type ResultsTableProps = SearchTableProps | BrowseTableProps;

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

/** Pull the state/region from a Nominatim-style string like "City, County, State, Postcode, Country".
 *  Walks right-to-left, skipping known country names and postcodes, and returns the first remaining segment. */
const COUNTRY_NOISE = new Set([
  "United States", "USA", "US",
  "United Kingdom", "UK", "Great Britain",
  "Canada", "Australia", "New Zealand", "México", "Mexico",
]);

function shortLocation(name: string): string {
  const parts = name.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (COUNTRY_NOISE.has(p)) continue;
    if (/^\d{2,}(-\d+)?$/.test(p)) continue; // postcode
    return p;
  }
  return parts[parts.length - 1];
}

export function ResultsTable(props: ResultsTableProps) {
  const isSearch = props.mode === "search";
  const { selectable, selectedIds, onSelectionChange } = props;
  const setRatingMut = useSetRating();
  const collectionsQuery = useCollections();
  const addToCollection = useAddToCollection();
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

  const handleOpenInFinder = async (path: string) => {
    try {
      await openInFinder(path);
    } catch {
      toast({ title: "Error", description: "Failed to open in Finder.", duration: 5000 });
    }
  };

  // Normalize rows into a common shape
  const rows = isSearch
    ? props.results.map((r) => ({
        key: r.video.fullPath,
        filename: r.video.filename,
        fullPath: r.video.fullPath,
        sizeBytes: r.video.sizeBytes,
        date: r.video.modifiedAt,
        ext: r.video.filename.split(".").pop()?.toLowerCase() ?? "",
        latitude: r.video.latitude,
        longitude: r.video.longitude,
        locationName: r.video.locationName,
        score: r.confidence,
        thumbUrl: thumbnailUrl({ id: r.video.id, type: r.video.type, ai_state: r.video.aiState }),
        mediaItem: r.mediaItem,
      }))
    : props.items.map((item) => ({
        key: `${item.id}`,
        filename: item.filename,
        fullPath: item.absolute_path,
        sizeBytes: item.size_bytes,
        date: new Date(item.mtime_ms),
        ext: item.file_ext.replace(/^\./, "").toLowerCase(),
        latitude: item.latitude,
        longitude: item.longitude,
        locationName: item.location_name,
        score: null as number | null,
        thumbUrl: thumbnailUrl(item),
        mediaItem: item,
      }));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="h-8 px-2 text-xs w-[36px]">
              <Checkbox
                checked={rows.length > 0 && selectedIds?.size === rows.length}
                onCheckedChange={(checked) => {
                  if (!onSelectionChange) return;
                  if (checked) {
                    onSelectionChange(new Set(rows.map((r) => r.mediaItem?.id).filter(Boolean) as number[]));
                  } else {
                    onSelectionChange(new Set());
                  }
                }}
              />
            </TableHead>
          )}
          <TableHead className="h-8 px-2 text-xs w-[72px]" />
          <TableHead className="h-8 px-2 text-xs">Filename</TableHead>
          {isSearch && <TableHead className="h-8 px-2 text-xs w-[60px]">Score</TableHead>}
          <TableHead className="h-8 px-2 text-xs w-[120px] hidden md:table-cell">Volume</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[60px] hidden sm:table-cell">Type</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[90px]">Size</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[100px] hidden sm:table-cell">Date Created</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[120px] hidden 2xl:table-cell">Location</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[70px] hidden sm:table-cell">Status</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[60px] text-center hidden lg:table-cell">AI</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[110px] hidden sm:table-cell">Rating</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[70px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow
            key={`${row.key}-${i}`}
            className={row.mediaItem && props.onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
            onClick={() => row.mediaItem && props.onRowClick?.(row.mediaItem)}
          >
            {selectable && (
              <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds?.has(row.mediaItem?.id ?? 0) ?? false}
                  onCheckedChange={(checked) => {
                    if (!onSelectionChange || !row.mediaItem) return;
                    const next = new Set(selectedIds);
                    if (checked) next.add(row.mediaItem.id);
                    else next.delete(row.mediaItem.id);
                    onSelectionChange(next);
                  }}
                />
              </TableCell>
            )}
            <TableCell className="px-2 py-1.5">
              {row.thumbUrl && !brokenThumbs.has(row.key) ? (
                <img
                  src={row.thumbUrl}
                  alt=""
                  loading="lazy"
                  onError={() =>
                    setBrokenThumbs((prev) => {
                      const next = new Set(prev);
                      next.add(row.key);
                      return next;
                    })
                  }
                  className="w-16 h-10 object-cover rounded-sm"
                />
              ) : (
                <div className="w-16 h-10 rounded-sm bg-muted flex items-center justify-center">
                  {row.mediaItem?.type === "video" ? (
                    <FilmStrip className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Image className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              )}
            </TableCell>
            <TableCell
              className="px-2 py-1.5 text-xs truncate max-w-[300px]"
              title={row.fullPath}
            >
              <span className="flex items-center gap-1">
                {row.mediaItem?.marked_for_delete === 1 && (
                  <Trash className="h-3 w-3 text-red-500 shrink-0" weight="fill" />
                )}
                {row.filename}
              </span>
            </TableCell>
            {isSearch && (
              <TableCell className="px-2 py-1.5 text-xs font-medium">
                {row.score != null ? (
                  row.score <= 1 ? (
                    <span className={`${row.score >= 0.5 ? "text-emerald-700 dark:text-emerald-400" : row.score >= 0.25 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {Math.round(row.score * 100)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{Math.abs(Math.round(row.score * 10) / 10)}</span>
                  )
                ) : "—"}
              </TableCell>
            )}
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[120px] hidden md:table-cell" title={row.mediaItem?.volume_name ?? ""}>
              {row.mediaItem?.volume_name ?? "—"}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground hidden sm:table-cell">
              .{row.ext}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
              {formatFileSize(row.sizeBytes)}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground hidden sm:table-cell">
              {row.date.toLocaleDateString()}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground hidden 2xl:table-cell">
              {row.latitude != null && row.longitude != null ? (
                <span
                  className="flex items-center gap-1 whitespace-nowrap"
                  title={row.locationName || formatCoords(row.latitude, row.longitude)}
                >
                  <MapPin className="h-3 w-3 text-green-700 dark:text-green-400 shrink-0" />
                  {row.locationName ? shortLocation(row.locationName) : formatCoords(row.latitude, row.longitude)}
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs hidden sm:table-cell">
              {row.mediaItem && (
                row.mediaItem.availability === "online" ? (
                  <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                    <WifiHigh className="h-3 w-3 shrink-0" />
                    Online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground/60">
                    <WifiSlash className="h-3 w-3 shrink-0" />
                    Offline
                  </span>
                )
              )}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-center hidden lg:table-cell">
              <div className="flex flex-col items-center gap-1">
                {row.mediaItem?.llava_state === "done" && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                      (row.mediaItem?.llava_version ?? 0) >= 2
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                    }`}
                    title={`Analyzed${(row.mediaItem?.llava_version ?? 0) >= 2 ? " v2" : " v1"}`}
                  >
                    <Brain className="h-3 w-3 shrink-0" />
                    {(row.mediaItem?.llava_version ?? 0) >= 2 ? "v2" : "v1"}
                  </span>
                )}
                {row.mediaItem?.llava_state === "error" && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-red-500/15 text-red-700 dark:text-red-400">
                    <Warning className="h-3 w-3 shrink-0" />
                    Analysis error
                  </span>
                )}
                {row.mediaItem?.type === "video" && row.mediaItem?.ai_state === "error" && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-red-500/15 text-red-700 dark:text-red-400">
                    <Warning className="h-3 w-3 shrink-0" />
                    Thumbnail error
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="px-2 py-1.5 hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Rate ${i} star${i === 1 ? "" : "s"}`}
                    className="inline-flex items-center justify-center h-6 w-5 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!row.mediaItem) return;
                      const next = i === 1 && row.mediaItem.rating === 1 ? 0 : i;
                      setRatingMut.mutate({ id: row.mediaItem.id, rating: next });
                    }}
                  >
                    <Star
                      className={`h-3.5 w-3.5 transition-colors ${i <= (row.mediaItem?.rating ?? 0) ? "text-foreground" : "text-muted-foreground/30 hover:text-muted-foreground/70"}`}
                      weight={i <= (row.mediaItem?.rating ?? 0) ? "fill" : "regular"}
                    />
                  </button>
                ))}
              </div>
            </TableCell>
            <TableCell className="px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(collectionsQuery.data ?? []).map((c: Collection) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => {
                          if (row.mediaItem) {
                            addToCollection.mutate({ collectionId: c.id, mediaIds: [row.mediaItem.id] });
                            toast({ title: "Added", description: `Added to "${c.name}"`, duration: 3000 });
                          }
                        }}
                      >
                        {c.name} ({c.itemCount})
                      </DropdownMenuItem>
                    ))}
                    {(collectionsQuery.data ?? []).length === 0 && (
                      <DropdownMenuItem disabled>No collections</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="Open in Finder"
                  onClick={(e) => { e.stopPropagation(); handleOpenInFinder(row.fullPath); }}
                >
                  <ArrowSquareOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
