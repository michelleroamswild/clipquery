import { ArrowSquareOut, Brain, Copy, Image, MapPin } from "@phosphor-icons/react";
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
import { formatTimestamp, formatFileSize } from "@/lib/mock-data";
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

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    toast({ title: "Copied", description: "Path copied to clipboard." });
  };

  const handleOpenInFinder = async (path: string) => {
    try {
      await openInFinder(path);
    } catch {
      toast({ title: "Error", description: "Failed to open in Finder." });
    }
  };

  const scoreColor = (c: number) =>
    c >= 0.8
      ? "text-green-400"
      : c >= 0.6
        ? "text-yellow-400"
        : "text-muted-foreground";

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
        timestamp: r.timestamp,
        confidence: r.confidence,
        thumbUrl: thumbnailUrl({ id: r.video.id, type: r.video.type, ai_state: r.video.aiState }),
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
        timestamp: null as number | null,
        confidence: null as number | null,
        thumbUrl: thumbnailUrl(item),
        mediaItem: item,
      }));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-8 px-2 text-xs w-[48px]" />
          <TableHead className="h-8 px-2 text-xs">Filename</TableHead>
          {isSearch && <TableHead className="h-8 px-2 text-xs w-[70px]">Time</TableHead>}
          {isSearch && <TableHead className="h-8 px-2 text-xs w-[60px]">Score</TableHead>}
          <TableHead className="h-8 px-2 text-xs w-[60px]">Type</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[90px]">Size</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[100px]">Date Created</TableHead>
          <TableHead className="h-8 px-2 text-xs w-[260px]">Location</TableHead>
          {!isSearch && <TableHead className="h-8 px-2 text-xs w-[32px] text-center" title="AI Analyzed"><Brain className="h-3 w-3 inline" /></TableHead>}
          <TableHead className="h-8 px-2 text-xs w-[70px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow
            key={`${row.key}-${i}`}
            className={"mediaItem" in row && props.onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
            onClick={() => "mediaItem" in row && props.onRowClick?.(row.mediaItem)}
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
              <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
                {row.timestamp != null ? formatTimestamp(row.timestamp) : "—"}
              </TableCell>
            )}
            {isSearch && (
              <TableCell className={`px-2 py-1.5 text-xs font-medium ${row.confidence != null ? scoreColor(row.confidence) : "text-muted-foreground"}`}>
                {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : "—"}
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
            {!isSearch && (
              <TableCell className="px-2 py-1.5 text-center">
                {"mediaItem" in row && row.mediaItem.llava_state === "done" && (
                  <Brain className="h-3 w-3 text-violet-400 inline" title="AI analyzed" />
                )}
              </TableCell>
            )}
            <TableCell className="px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Open in Finder"
                  onClick={(e) => { e.stopPropagation(); handleOpenInFinder(row.fullPath); }}
                >
                  <ArrowSquareOut className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Copy path"
                  onClick={(e) => { e.stopPropagation(); copyPath(row.fullPath); }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
