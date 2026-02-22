import { ArrowSquareOut, Brain, Image, MapPin, WifiHigh, WifiSlash } from "@phosphor-icons/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { openInFinder, thumbnailUrl } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import type { MediaItemRow } from "@/lib/api-client";
import type { SearchResult } from "@/types/video";

interface SearchTableProps {
  mode: "search";
  results: SearchResult[];
  onRowClick?: (item: MediaItemRow) => void;
}

interface BrowseTableProps {
  mode: "browse";
  items: MediaItemRow[];
  onRowClick?: (item: MediaItemRow) => void;
}

type ResultsTableProps = SearchTableProps | BrowseTableProps;

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

export function ResultsTable(props: ResultsTableProps) {
  const isSearch = props.mode === "search";

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
          <TableHead className="h-8 px-2 text-xs w-[48px]" />
          <TableHead className="h-8 px-2 text-xs">Filename</TableHead>
          {isSearch && <TableHead className="h-8 px-2 text-xs w-[60px]">Score</TableHead>}
          <TableHead className="h-8 px-2 text-xs w-[60px]">Type</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[90px]">Size</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[100px]">Date Created</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[260px]">Location</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[70px]">Status</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[110px] text-center">AI</TableHead>
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
            <TableCell className="px-2 py-1.5">
              {row.thumbUrl ? (
                <img
                  src={row.thumbUrl}
                  alt=""
                  loading="lazy"
                  className="w-10 h-7 object-cover rounded-sm"
                />
              ) : (
                <div className="w-10 h-7 rounded-sm bg-muted flex items-center justify-center">
                  <Image className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </TableCell>
            <TableCell
              className="px-2 py-1.5 text-xs truncate max-w-[300px]"
              title={row.fullPath}
            >
              {row.filename}
            </TableCell>
            {isSearch && (
              <TableCell className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {row.score != null ? Math.abs(Math.round(row.score * 10) / 10) : "—"}
              </TableCell>
            )}
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
              .{row.ext}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
              {formatFileSize(row.sizeBytes)}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
              {row.date.toLocaleDateString()}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
              {row.latitude != null && row.longitude != null ? (
                <span
                  className="flex items-center gap-1 whitespace-nowrap"
                  title={formatCoords(row.latitude, row.longitude)}
                >
                  <MapPin className="h-3 w-3 text-green-400 shrink-0" />
                  {row.locationName || formatCoords(row.latitude, row.longitude)}
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </TableCell>
            <TableCell className="px-2 py-1.5 text-xs">
              {row.mediaItem && (
                row.mediaItem.availability === "online" ? (
                  <span className="flex items-center gap-1 text-green-400">
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
            <TableCell className="px-2 py-1.5 text-center">
              {row.mediaItem?.llava_state === "done" && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                  (row.mediaItem?.llava_version ?? 0) >= 2
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-violet-500/15 text-violet-400"
                }`}>
                  <Brain className="h-3 w-3 shrink-0" />
                  {(row.mediaItem?.llava_version ?? 0) >= 2 ? "Analyzed v2" : "Analyzed"}
                </span>
              )}
            </TableCell>
            <TableCell className="px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={(e) => { e.stopPropagation(); handleOpenInFinder(row.fullPath); }}
                >
                  <ArrowSquareOut className="mr-1 h-3.5 w-3.5" />
                  Open in Finder
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
