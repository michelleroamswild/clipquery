import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, FilmStrip, Database, Brain, MapPin, HardDrive, SpinnerGap } from "@phosphor-icons/react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { useDashboard, useMediaStats } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import { fetchBackgroundStatus, type BackgroundStatus } from "@/lib/api-client";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function stateCount(states: { state: string; count: number }[], key: string): number {
  return states.find((s) => s.state === key)?.count ?? 0;
}

const Dashboard = () => {
  const { data, isLoading } = useDashboard();
  const statsQuery = useMediaStats();
  const scanMutation = useScanDirectory();
  const [bgStatus, setBgStatus] = useState<BackgroundStatus | null>(null);

  // Poll background analysis status
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      try {
        const s = await fetchBackgroundStatus();
        setBgStatus(s);
        if (!s.running && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        setBgStatus(null);
      }
    };

    check();
    timer = setInterval(check, 3000);
    return () => { if (timer) clearInterval(timer); };
  }, []);

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
  };

  const totalCount = data?.totals.count ?? 0;
  const photoCount = data?.byType.find((t) => t.type === "photo")?.count ?? 0;
  const videoCount = data?.byType.find((t) => t.type === "video")?.count ?? 0;
  const llavaDone = stateCount(data?.byLlavaState ?? [], "done");
  const aiDone = stateCount(data?.byAiState ?? [], "done");
  const aiError = stateCount(data?.byAiState ?? [], "error");
  const llavaError = stateCount(data?.byLlavaState ?? [], "error");
  const gpsWithCount = data?.gps.with_gps ?? 0;

  const aiPercent = totalCount > 0 ? Math.round((aiDone / totalCount) * 100) : 0;
  const llavaPercent = totalCount > 0 ? Math.round((llavaDone / totalCount) * 100) : 0;
  const gpsPercent = totalCount > 0 ? Math.round((gpsWithCount / totalCount) * 100) : 0;

  const timelineConfig = {
    count: { label: "Items", color: "hsl(var(--primary))" },
  };

  const extConfig = {
    count: { label: "Files", color: "hsl(var(--primary))" },
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <VideoSearchSidebar
          onScan={handleScan}
          videoCount={totalCount}
          lastScanTime={scanMutation.isSuccess ? new Date() : null}
          isScanning={scanMutation.isPending}
          stats={statsQuery.data}
        />

        <SidebarInset>
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <SidebarTrigger />
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              Dashboard
            </h1>
          </header>

          <div className="w-full px-6 py-6 space-y-6">
            {isLoading && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                Loading dashboard...
              </div>
            )}

            {!isLoading && totalCount === 0 && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                No media indexed yet. Scan a volume from the sidebar to get started.
              </div>
            )}

            {!isLoading && totalCount > 0 && data && (
              <>
                {/* Row 1: Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
                      <Database className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalCount.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">{formatBytes(data.totals.total_size)}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Photos</CardTitle>
                      <Camera className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{photoCount.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(data.byType.find((t) => t.type === "photo")?.size ?? 0)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Videos</CardTitle>
                      <FilmStrip className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{videoCount.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(data.byType.find((t) => t.type === "video")?.size ?? 0)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">AI Analyzed</CardTitle>
                      <Brain className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{llavaDone.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">{llavaPercent}% of library</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 2: Timeline chart */}
                {data.timeline.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium">Items by Month</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={timelineConfig} className="h-[250px] w-full">
                        <BarChart data={data.timeline}>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="month"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: string) => {
                              const [y, m] = v.split("-");
                              return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y.slice(2)}`;
                            }}
                            interval="preserveStartEnd"
                            minTickGap={40}
                          />
                          <YAxis tickLine={false} axisLine={false} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Row 3: File types + Top locations */}
                <div className="grid md:grid-cols-2 gap-4">
                  {data.topExtensions.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm font-medium">File Types</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ChartContainer config={extConfig} className="h-[250px] w-full">
                          <BarChart data={data.topExtensions} layout="vertical">
                            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                            <XAxis type="number" tickLine={false} axisLine={false} />
                            <YAxis
                              type="category"
                              dataKey="file_ext"
                              tickLine={false}
                              axisLine={false}
                              width={60}
                            />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ChartContainer>
                      </CardContent>
                    </Card>
                  )}

                  {data.topLocations.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm font-medium">Top Locations</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-[250px] overflow-y-auto">
                          {data.topLocations.map((loc) => (
                            <div key={loc.location_name} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{loc.location_name}</span>
                              </div>
                              <Badge variant="secondary" className="ml-2 shrink-0">
                                {loc.count.toLocaleString()}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Row 4: Processing pipeline */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Processing Pipeline</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Poster Frames</span>
                        <span className="text-muted-foreground">
                          {aiDone.toLocaleString()} / {totalCount.toLocaleString()}
                          {aiError > 0 && <span className="text-destructive ml-1">({aiError} errors)</span>}
                        </span>
                      </div>
                      <Progress value={aiPercent} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5">
                          AI Analysis
                          {bgStatus?.running && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                              <SpinnerGap className="h-3 w-3 animate-spin" />
                              Running
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {bgStatus?.running ? (
                            <>
                              {bgStatus.processed.toLocaleString()} done &middot; {bgStatus.remaining.toLocaleString()} remaining
                              {bgStatus.failed > 0 && <span className="text-destructive ml-1">({bgStatus.failed} failed)</span>}
                            </>
                          ) : (
                            <>
                              {llavaDone.toLocaleString()} / {totalCount.toLocaleString()}
                              {llavaError > 0 && <span className="text-destructive ml-1">({llavaError} errors)</span>}
                            </>
                          )}
                        </span>
                      </div>
                      <Progress value={llavaPercent} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>GPS Data</span>
                        <span className="text-muted-foreground">
                          {gpsWithCount.toLocaleString()} / {totalCount.toLocaleString()}
                        </span>
                      </div>
                      <Progress value={gpsPercent} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                {/* Row 5: Volume breakdown */}
                {data.volumes.length > 0 && (
                  <div>
                    <h2 className="text-sm font-medium mb-3">Volumes</h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {data.volumes.map((vol) => (
                        <Link
                          key={vol.volume_name}
                          to={`/volume/${encodeURIComponent(vol.volume_name ?? "Local")}`}
                          className="block"
                        >
                          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                            <CardHeader className="flex flex-row items-center gap-2 pb-2">
                              <HardDrive className="h-4 w-4 text-muted-foreground" />
                              <CardTitle className="text-sm font-medium truncate">
                                {vol.volume_name ?? "Local"}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-1">
                              <div className="text-xs text-muted-foreground">
                                {vol.count.toLocaleString()} items &middot; {formatBytes(vol.size)}
                              </div>
                              <div className="flex gap-2 text-xs text-muted-foreground">
                                {vol.photos > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Camera className="h-3 w-3" /> {vol.photos.toLocaleString()}
                                  </span>
                                )}
                                {vol.videos > 0 && (
                                  <span className="flex items-center gap-1">
                                    <FilmStrip className="h-3 w-3" /> {vol.videos.toLocaleString()}
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Dashboard;
