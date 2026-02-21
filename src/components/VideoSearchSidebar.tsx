import { useState } from "react";
import { FolderOpen, HardDrive, Database, Usb, SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { MediaStatsResponse } from "@/lib/api-client";
import { useVolumes } from "@/hooks/use-volumes";

interface VideoSearchSidebarProps {
  onScan: (dirPath: string) => Promise<void> | void;
  videoCount: number;
  lastScanTime: Date | null;
  isScanning: boolean;
  stats?: MediaStatsResponse;
}

export function VideoSearchSidebar({
  onScan,
  videoCount,
  lastScanTime,
  isScanning,
  stats,
}: VideoSearchSidebarProps) {
  const [interval, setInterval] = useState<SamplingInterval>("5s");
  const [scanningPath, setScanningPath] = useState<string | null>(null);
  const { data: volumesData } = useVolumes();
  const volumes = volumesData?.volumes ?? [];
  const indexedVolumeNames = new Set(
    stats?.byVolume.map((v) => v.volume_name) ?? []
  );

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
            <SidebarGroupLabel>Mounted Volumes</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 space-y-2">
              {volumes.length === 0 && (
                <p className="text-xs text-muted-foreground">No external volumes detected</p>
              )}
              {volumes.map((vol) => {
                const indexed = indexedVolumeNames.has(vol.name);
                return (
                  <div
                    key={vol.mountPoint}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Usb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs truncate">{vol.name}</span>
                      {indexed && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          Indexed
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2 shrink-0"
                      disabled={isScanning}
                      onClick={async () => {
                        setScanningPath(vol.mountPoint);
                        try {
                          await onScan(vol.mountPoint);
                        } finally {
                          setScanningPath(null);
                        }
                      }}
                    >
                      {scanningPath === vol.mountPoint && (
                        <SpinnerGap className="h-3 w-3 animate-spin" />
                      )}
                      {indexed ? "Rescan" : "Scan"}
                    </Button>
                  </div>
                );
              })}
            </SidebarGroupContent>
          </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sampling Interval</SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
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

        {stats && stats.total > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Database Stats</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                <span>{stats.total} total items</span>
              </div>
              {stats.byType.map((t) => (
                <div key={t.type} className="text-xs text-muted-foreground pl-5">
                  {t.count} {t.type}{t.count !== 1 ? "s" : ""}
                </div>
              ))}
              {stats.byAvailability.map((a) => (
                <div key={a.availability} className="text-xs text-muted-foreground pl-5">
                  {a.count} {a.availability}
                </div>
              ))}
              {stats.byVolume.length > 0 && (
                <div className="pt-1">
                  <div className="text-[11px] font-medium text-muted-foreground">Volumes</div>
                  {stats.byVolume.map((v) => (
                    <div key={v.volume_name} className="text-xs text-muted-foreground pl-5">
                      {v.volume_name}: {v.count}
                    </div>
                  ))}
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" />
          <span>
            {videoCount > 0
              ? `${videoCount} file${videoCount !== 1 ? "s" : ""} indexed`
              : "No files scanned"}
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
