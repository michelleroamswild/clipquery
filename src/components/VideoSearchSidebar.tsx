import { useState } from "react";
import { FolderSearch, HardDrive, ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import type { SamplingInterval } from "@/types/video";

interface VideoSearchSidebarProps {
  onScan: (dirPath: string) => void;
  videoCount: number;
  lastScanTime: Date | null;
  isScanning: boolean;
}

export function VideoSearchSidebar({
  onScan,
  videoCount,
  lastScanTime,
  isScanning,
}: VideoSearchSidebarProps) {
  const [dirPath, setDirPath] = useState("/Users/me/Videos");
  const [interval, setInterval] = useState<SamplingInterval>("5s");
  const [error, setError] = useState("");

  const handleScan = () => {
    const trimmed = dirPath.trim();
    if (!trimmed || trimmed.length < 2) {
      setError("Please enter a valid directory path.");
      return;
    }
    setError("");
    onScan(trimmed);
  };

  return (
    <Sidebar className="border-r border-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Indexer</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Index Location</SidebarGroupLabel>
          <SidebarGroupContent className="px-2 space-y-2">
            <Input
              placeholder="/path/to/videos"
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              className="font-mono text-xs"
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <Button
              onClick={handleScan}
              disabled={isScanning}
              size="sm"
              className="w-full"
            >
              <ScanLine className="mr-2 h-4 w-4" />
              {isScanning ? "Scanning…" : "Scan for .mp4 files"}
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sampling Interval</SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            {/* TODO: Wire this to the frame extraction pipeline */}
            <Select
              value={interval}
              onValueChange={(v) => setInterval(v as SamplingInterval)}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2s">Every 2 seconds</SelectItem>
                <SelectItem value="5s">Every 5 seconds</SelectItem>
                <SelectItem value="10s">Every 10 seconds</SelectItem>
              </SelectContent>
            </Select>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FolderSearch className="h-3.5 w-3.5" />
          <span>
            {videoCount > 0
              ? `${videoCount} video${videoCount !== 1 ? "s" : ""} indexed`
              : "No videos scanned"}
          </span>
        </div>
        {lastScanTime && (
          <p className="text-[10px] text-muted-foreground">
            Last scan:{" "}
            {lastScanTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
