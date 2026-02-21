import { ArrowSquareOut, Copy, MapPin } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { thumbnailUrl, openInFinder } from "@/lib/api-client";
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
  if (!item) return null;

  const thumbUrl = thumbnailUrl(item);
  const ext = item.file_ext.replace(/^\./, "").toLowerCase();

  const copyPath = () => {
    navigator.clipboard.writeText(item.absolute_path);
    toast({ title: "Copied", description: "Path copied to clipboard." });
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
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] overflow-y-auto p-0">
        {/* Thumbnail */}
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.filename}
            className="w-full aspect-video object-cover"
          />
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-xs">
            No thumbnail
          </div>
        )}

        <div className="p-6 space-y-5">
          {/* Header */}
          <SheetHeader>
            <SheetTitle className="text-base break-all leading-snug">
              {item.filename}
            </SheetTitle>
            <SheetDescription>
              <span className="inline-block mt-1 rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                .{ext}
              </span>
            </SheetDescription>
          </SheetHeader>

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
