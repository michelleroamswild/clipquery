import { useState } from "react";
import { FolderOpen, HardDrive, Database, Usb, SpinnerGap, CaretRight, Camera, FilmStrip } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
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
  const [scanningPath, setScanningPath] = useState<string | null>(null);
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set());
  const { data: volumesData } = useVolumes();
  const volumes = volumesData?.volumes ?? [];
  const volumeDetailMap = new Map(
    (stats?.byVolumeDetail ?? []).map((d) => [d.volume_name, d])
  );

  const allExpanded = volumes.length > 0 && volumes.every((v) => expandedVolumes.has(v.mountPoint));
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedVolumes(new Set());
    } else {
      setExpandedVolumes(new Set(volumes.map((v) => v.mountPoint)));
    }
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
            <div className="flex items-center justify-between">
              <SidebarGroupLabel>Mounted Volumes</SidebarGroupLabel>
              {volumes.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2"
                >
                  {allExpanded ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
            <SidebarGroupContent className="px-2 space-y-1">
              {volumes.length === 0 && (
                <p className="text-xs text-muted-foreground">No external volumes detected</p>
              )}
              {volumes.map((vol) => {
                const detail = volumeDetailMap.get(vol.name);
                const indexed = !!detail;
                return (
                  <Collapsible
                    key={vol.mountPoint}
                    open={expandedVolumes.has(vol.mountPoint)}
                    onOpenChange={(open) => {
                      setExpandedVolumes((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(vol.mountPoint);
                        else next.delete(vol.mountPoint);
                        return next;
                      });
                    }}
                  >
                    <CollapsibleTrigger className="flex items-center justify-between gap-2 w-full rounded-md px-1.5 py-1 hover:bg-muted/50 transition-colors group">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CaretRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                        <Usb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs truncate">{vol.name}</span>
                      </div>
                      {indexed && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                          {detail.total.toLocaleString()}
                        </Badge>
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-5 pl-2 border-l border-border space-y-2 py-2">
                        {indexed ? (
                          <>
                            <div className="space-y-0.5">
                              {detail.photos > 0 && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Camera className="h-3 w-3" />
                                  <span>{detail.photos.toLocaleString()} photo{detail.photos !== 1 ? "s" : ""}</span>
                                </div>
                              )}
                              {detail.videos > 0 && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <FilmStrip className="h-3 w-3" />
                                  <span>{detail.videos.toLocaleString()} video{detail.videos !== 1 ? "s" : ""}</span>
                                </div>
                              )}
                            </div>
                            {detail.lastScan && (
                              <p className="text-[10px] text-muted-foreground/70">
                                Last scan: {new Date(detail.lastScan + "Z").toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/70">Not yet scanned</p>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2 w-full"
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
                            <SpinnerGap className="h-3 w-3 mr-1 animate-spin" />
                          )}
                          {indexed ? "Rescan" : "Scan"}
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </SidebarGroupContent>
          </SidebarGroup>

        {stats && stats.total > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Database Stats</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                <span>{stats.total.toLocaleString()} total items</span>
              </div>
              {stats.byType.map((t) => (
                <div key={t.type} className="text-xs text-muted-foreground pl-5">
                  {t.count.toLocaleString()} {t.type}{t.count !== 1 ? "s" : ""}
                </div>
              ))}
              {stats.byAvailability.map((a) => (
                <div key={a.availability} className="text-xs text-muted-foreground pl-5">
                  {a.count.toLocaleString()} {a.availability}
                </div>
              ))}
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
