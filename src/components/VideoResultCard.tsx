import { useState } from "react";
import {
  Copy,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Film,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { SearchResult } from "@/types/video";
import { formatTimestamp, formatFileSize } from "@/lib/mock-data";

interface VideoResultCardProps {
  result: SearchResult;
}

export function VideoResultCard({ result }: VideoResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { video, timestamp, confidence } = result;
  const ts = formatTimestamp(timestamp);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  const confidenceColor =
    confidence >= 0.8
      ? "text-green-400"
      : confidence >= 0.6
        ? "text-yellow-400"
        : "text-muted-foreground";

  return (
    <Card className="p-4 bg-card border-border hover:border-muted-foreground/30 transition-colors">
      <div className="flex gap-4">
        {/* Thumbnail placeholder */}
        <div className="flex-shrink-0 w-28 h-20 rounded-md bg-muted flex items-center justify-center">
          {/* TODO: Replace with actual frame thumbnail from video at matched timestamp */}
          <Film className="h-8 w-8 text-muted-foreground/50" />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Filename + expand toggle */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground truncate">
                {video.filename}
              </h3>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-0.5"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {expanded ? "Hide path" : "Show path"}
              </button>
              {expanded && (
                <p className="text-[11px] text-muted-foreground font-mono mt-1 break-all">
                  {video.fullPath}
                </p>
              )}
            </div>

            {/* Confidence */}
            <Badge variant="outline" className={`text-xs shrink-0 ${confidenceColor}`}>
              {Math.round(confidence * 100)}%
            </Badge>
          </div>

          {/* Timestamp + size */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {ts}
            </span>
            <span>{formatFileSize(video.sizeBytes)}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            {/* TODO: Wire to OS file open (Electron shell.openPath / Tauri open) */}
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
              <ExternalLink className="mr-1 h-3 w-3" />
              Open
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => copyToClipboard(video.fullPath, "Path")}
            >
              <Copy className="mr-1 h-3 w-3" />
              Copy path
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => copyToClipboard(ts, "Timestamp")}
            >
              <Clock className="mr-1 h-3 w-3" />
              Copy time
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
