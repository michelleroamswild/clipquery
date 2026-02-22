import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Folder,
  CaretRight,
  MapPin,
  HardDrive,
  Camera,
  FilmStrip,
  Database,
  ArrowLeft,
  X,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useFolders, useUpdateFolderLocation } from "@/hooks/use-folders";
import { useDashboard, useMediaStats } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import { useToast } from "@/hooks/use-toast";
import { searchGeocode, fetchFolderInfo, type FolderNode, type GeocodeSearchResult } from "@/lib/api-client";

// --- Folder tree node ---

function FolderTreeNode({
  node,
  volume,
  selectedPath,
  onSelect,
}: {
  node: FolderNode;
  volume: string;
  selectedPath: string | null;
  onSelect: (folder: FolderNode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: childData } = useFolders(volume, node.path, expanded);
  const children = childData?.folders ?? [];
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        className={`flex items-center gap-1.5 w-full rounded-md px-2 py-1.5 text-sm transition-colors text-left ${
          isSelected
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted/50"
        }`}
        onClick={() => {
          onSelect(node);
          if (node.hasChildren) setExpanded((p) => !p);
        }}
      >
        {node.hasChildren ? (
          <CaretRight
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : (
          <span className="w-3.5" />
        )}
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {node.hasLocation && <MapPin className="h-3 w-3 shrink-0 text-green-400" />}
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
          {node.itemCount.toLocaleString()}
        </Badge>
      </button>

      {expanded && children.length > 0 && (
        <div className="ml-4 pl-2 border-l border-border">
          {children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              volume={volume}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Folder detail sidebar panel ---

function FolderDetailPanel({
  folder,
  onClose,
  onSave,
  saving,
}: {
  folder: FolderNode;
  onClose: () => void;
  onSave: (data: {
    locationName: string;
    latitude: number;
    longitude: number;
    includeSubfolders: boolean;
    preserveExistingGps: boolean;
  }) => void;
  saving: boolean;
}) {
  const [coords, setCoords] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [preserveExistingGps, setPreserveExistingGps] = useState(true);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Fetch current location for this folder
  useEffect(() => {
    setLoadingInfo(true);
    setCoords("");
    setSearchQuery("");
    fetchFolderInfo(folder.path)
      .then((info) => {
        if (info.locationName) {
          setSearchQuery(info.locationName);
        }
        if (info.latitude != null && info.longitude != null) {
          setCoords(`${info.latitude}, ${info.longitude}`);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [folder.path]);

  // Parse coords string into lat/lng
  const parsedCoords = (() => {
    const match = coords.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
    if (!match) return null;
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  })();

  // Reverse geocode when coords are manually entered and location name is empty
  const reverseGeocodeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  useEffect(() => {
    if (!parsedCoords || searchQuery.trim()) { setReverseGeocoding(false); return; }
    setReverseGeocoding(true);
    if (reverseGeocodeRef.current) clearTimeout(reverseGeocodeRef.current);
    reverseGeocodeRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${parsedCoords.lat}&lon=${parsedCoords.lng}&format=json`,
          { headers: { "User-Agent": "ClipQuery/1.0" } }
        );
        if (!resp.ok) return;
        const data = await resp.json() as { display_name?: string };
        if (data.display_name) {
          setSearchQuery(data.display_name);
        }
      } catch {
        // ignore
      } finally {
        setReverseGeocoding(false);
      }
    }, 500);
    return () => { if (reverseGeocodeRef.current) clearTimeout(reverseGeocodeRef.current); };
  }, [coords, parsedCoords?.lat, parsedCoords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await searchGeocode(q);
        setSuggestions(resp.results);
        setShowSuggestions(resp.results.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectSuggestion = (result: GeocodeSearchResult) => {
    setSearchQuery(result.display_name);
    setCoords(`${result.lat}, ${result.lon}`);
    setShowSuggestions(false);
  };

  const handleSave = () => {
    if (!searchQuery.trim() || !parsedCoords) return;
    onSave({
      locationName: searchQuery.trim(),
      latitude: parsedCoords.lat,
      longitude: parsedCoords.lng,
      includeSubfolders,
      preserveExistingGps,
    });
  };

  return (
    <div className="w-80 border-l border-border bg-background flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold truncate">Folder Details</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Folder info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium truncate">{folder.name}</span>
          </div>
          <p className="text-xs text-muted-foreground break-all">{folder.path}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>{folder.itemCount.toLocaleString()} item{folder.itemCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        <Separator />

        {/* Set location */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">Set Location</h4>
          </div>

          {/* Place search */}
          <div className="space-y-2">
            <Label htmlFor="location-search" className="text-xs">Location Name</Label>
            <div className="relative" ref={dropdownRef}>
              <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="location-search"
                placeholder="Type a place name..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) {
                    setCoords("");
                  }
                }}
                className="h-8 text-sm pl-8"
              />
              {searching && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  ...
                </div>
              )}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors border-b border-border last:border-0"
                      onClick={() => selectSuggestion(s)}
                    >
                      <div className="truncate font-medium" title={s.display_name}>{s.display_name}</div>
                      <div className="text-muted-foreground mt-0.5">
                        {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* GPS coordinates — single input */}
          <div className="space-y-2">
            <Label htmlFor="coords" className="text-xs">Coordinates</Label>
            <Input
              id="coords"
              placeholder="48.8566, 2.3522"
              value={coords}
              onChange={(e) => setCoords(e.target.value)}
              className={`h-8 text-sm ${coords && !parsedCoords ? "border-red-500/50" : ""}`}
            />
            {coords && !parsedCoords && (
              <p className="text-[11px] text-red-400">Enter as lat, lng (e.g. 48.8566, 2.3522)</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-sub"
                checked={includeSubfolders}
                onCheckedChange={(v) => setIncludeSubfolders(!!v)}
              />
              <Label htmlFor="include-sub" className="text-xs font-normal">
                Include sub-folders
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="preserve-gps"
                checked={preserveExistingGps}
                onCheckedChange={(v) => setPreserveExistingGps(!!v)}
              />
              <Label htmlFor="preserve-gps" className="text-xs font-normal">
                Don't override existing GPS
              </Label>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || reverseGeocoding || !searchQuery.trim() || !parsedCoords}
            className="w-full h-8 text-sm"
          >
            {saving ? "Saving..." : reverseGeocoding ? "Looking up location..." : "Apply Location to Folder"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Main page ---

const VolumeDetail = () => {
  const { volumeName } = useParams<{ volumeName: string }>();
  const decodedVolume = decodeURIComponent(volumeName ?? "");
  const { data: dashboard } = useDashboard();
  const statsQuery = useMediaStats();
  const scanMutation = useScanDirectory();
  const { toast } = useToast();

  const volumeStats = dashboard?.volumes.find(
    (v) => v.volume_name === decodedVolume
  );

  const { data: rootFolders, isLoading: foldersLoading } = useFolders(decodedVolume);
  const updateLocation = useUpdateFolderLocation();

  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null);

  const handleSelect = useCallback((folder: FolderNode) => {
    setSelectedFolder((prev) => (prev?.path === folder.path ? null : folder));
  }, []);

  const handleSaveLocation = useCallback(
    (data: {
      locationName: string;
      latitude: number;
      longitude: number;
      includeSubfolders: boolean;
      preserveExistingGps: boolean;
    }) => {
      if (!selectedFolder) return;
      updateLocation.mutate(
        {
          folderPath: selectedFolder.path,
          locationName: data.locationName,
          latitude: data.latitude,
          longitude: data.longitude,
          includeSubfolders: data.includeSubfolders,
          preserveExistingGps: data.preserveExistingGps,
        },
        {
          onSuccess: (result) => {
            toast({
              title: "Location updated",
              description: `Updated ${result.updated} item${result.updated !== 1 ? "s" : ""}.`,
              duration: 5000,
            });
          },
          onError: (err) => {
            toast({
              title: "Error",
              description: err instanceof Error ? err.message : "Failed to update location",
              variant: "destructive",
              duration: 5000,
            });
          },
        }
      );
    },
    [selectedFolder, updateLocation, toast]
  );

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
  };

  const totalCount = volumeStats?.count ?? 0;
  const totalSize = volumeStats?.size ?? 0;
  const photoCount = volumeStats?.photos ?? 0;
  const videoCount = volumeStats?.videos ?? 0;
  const folders = rootFolders?.folders ?? [];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <VideoSearchSidebar
          onScan={handleScan}
          videoCount={dashboard?.totals.count ?? 0}
          lastScanTime={scanMutation.isSuccess ? new Date() : null}
          isScanning={scanMutation.isPending}
          stats={statsQuery.data}
        />

        <SidebarInset>
          <div className="flex h-screen flex-col">
            <header className="flex items-center gap-3 border-b border-border px-6 py-3 shrink-0">
              <SidebarTrigger />
              <Link
                to="/dashboard"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                {decodedVolume || "Unknown Volume"}
              </h1>
            </header>

            <div className="flex flex-1 min-h-0">
              {/* Main content: stats + folder tree */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {/* Volume stats header */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Database className="h-4 w-4" />
                    <span>{totalCount.toLocaleString()} items</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>{formatBytes(totalSize)}</span>
                  </div>
                  {photoCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Camera className="h-4 w-4" />
                      <span>{photoCount.toLocaleString()} photos</span>
                    </div>
                  )}
                  {videoCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <FilmStrip className="h-4 w-4" />
                      <span>{videoCount.toLocaleString()} videos</span>
                    </div>
                  )}
                </div>

                {/* Folder tree */}
                <div>
                  <h2 className="text-sm font-medium mb-3">Folder Tree</h2>
                  <p className="text-xs text-muted-foreground mb-3">
                    Click a folder to view details and set its location.
                  </p>
                  {foldersLoading && (
                    <p className="text-sm text-muted-foreground">Loading folders...</p>
                  )}
                  {!foldersLoading && folders.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No folders found for this volume.
                    </p>
                  )}
                  {folders.length > 0 && (
                    <ScrollArea className="h-[calc(100vh-280px)] rounded-md border p-3">
                      <div className="space-y-0.5">
                        {folders.map((folder) => (
                          <FolderTreeNode
                            key={folder.path}
                            node={folder}
                            volume={decodedVolume}
                            selectedPath={selectedFolder?.path ?? null}
                            onSelect={handleSelect}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>

              {/* Detail sidebar */}
              {selectedFolder && (
                <FolderDetailPanel
                  key={selectedFolder.path}
                  folder={selectedFolder}
                  onClose={() => setSelectedFolder(null)}
                  onSave={handleSaveLocation}
                  saving={updateLocation.isPending}
                />
              )}
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default VolumeDetail;
