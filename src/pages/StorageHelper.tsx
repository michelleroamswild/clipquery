import { useState } from "react";
import {
  ArrowSquareOut, Broom, Brain, CopySimple, FilmStrip, HardDrive,
  Image, ImageBroken, MapPin, SpinnerGap, Trash, Warning, WifiHigh, WifiSlash, X,
} from "@phosphor-icons/react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { openInFinder, thumbnailUrl, type StorageMediaItem, type StorageFilters } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import { useMediaStats, useMediaExtensions } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import { toast } from "sonner";
import { toast as toastOld } from "@/hooks/use-toast";
import {
  useStorageScanStatus,
  useStartStorageScan,
  useStopStorageScan,
  useDuplicates,
  useShortVideos,
  useBlurry,
  useLargeFiles,
  useDeleteStorageFiles,
} from "@/hooks/use-storage";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)}ms`;
  return `${sec.toFixed(1)}s`;
}

function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

// ── Open in Finder ──────────────────────────────────────────────

async function handleOpenInFinder(path: string) {
  try {
    await openInFinder(path);
  } catch {
    toastOld({ title: "Error", description: "Failed to open in Finder.", duration: 5000 });
  }
}

// ── Scan Progress Section ───────────────────────────────────────

function ScanProgress() {
  const { data: s } = useStorageScanStatus(2000);
  const startMut = useStartStorageScan();
  const stopMut = useStopStorageScan();

  const percent = s && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Broom className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Storage Scan</span>
          {s?.running && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
              <SpinnerGap className="h-3 w-3 animate-spin" />
              Scanning
            </Badge>
          )}
        </div>
        {s?.running ? (
          <Button size="sm" variant="outline" onClick={() => stopMut.mutate()} disabled={stopMut.isPending}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => startMut.mutate()} disabled={startMut.isPending}>
            {startMut.isPending && <SpinnerGap className="h-3 w-3 mr-1 animate-spin" />}
            Start Scan
          </Button>
        )}
      </div>
      {s?.running && (
        <>
          <Progress value={percent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {s.processed.toLocaleString()} / {s.total.toLocaleString()} items processed
            {s.remaining > 0 && ` · ${s.remaining.toLocaleString()} remaining`}
          </p>
        </>
      )}
      {!s?.running && s && s.processed > 0 && (
        <p className="text-xs text-muted-foreground">
          Last scan processed {s.processed.toLocaleString()} items
        </p>
      )}
    </div>
  );
}

// ── Delete Confirmation Dialog ──────────────────────────────────

function DeleteDialog({
  open, selectedIds, selectedSize, onConfirm, onCancel, isPending,
}: {
  open: boolean;
  selectedIds: number[];
  selectedSize: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move {selectedIds.length} file{selectedIds.length !== 1 ? "s" : ""} ({formatBytes(selectedSize)}) to the macOS Trash.
            You can recover them from Trash if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending && <SpinnerGap className="h-3 w-3 mr-1 animate-spin" />}
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Selection + Delete hook ─────────────────────────────────────

function useSelection(items: StorageMediaItem[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDelete, setShowDelete] = useState(false);
  const deleteMut = useDeleteStorageFiles();

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const selectedSize = items
    .filter((i) => selected.has(i.id))
    .reduce((sum, i) => sum + i.size_bytes, 0);

  const confirmDelete = () => {
    deleteMut.mutate(Array.from(selected), {
      onSuccess: (res) => {
        toast.success(`Moved ${res.trashed} file${res.trashed !== 1 ? "s" : ""} to Trash (${formatBytes(res.freedBytes)} freed)`);
        setSelected(new Set());
        setShowDelete(false);
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  return { selected, toggle, toggleAll, selectedSize, showDelete, setShowDelete, confirmDelete, isDeleting: deleteMut.isPending };
}

// ── Delete bar ──────────────────────────────────────────────────

function DeleteBar({ count, size, onDelete }: { count: number; size: number; onDelete: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2">
      <span className="text-sm">{count} selected ({formatBytes(size)})</span>
      <Button size="sm" variant="destructive" onClick={onDelete}>
        <Trash className="h-3 w-3 mr-1" />
        Move to Trash
      </Button>
    </div>
  );
}

// ── Shared table row cells (matching ResultsTable style) ────────

function ThumbCell({ item }: { item: StorageMediaItem }) {
  const url = thumbnailUrl(item);
  return url ? (
    <img src={url} alt="" loading="lazy" className="w-10 h-7 object-cover rounded-sm" />
  ) : (
    <div className="w-10 h-7 rounded-sm bg-muted flex items-center justify-center">
      <Image className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

function LocationCell({ item }: { item: StorageMediaItem }) {
  if (item.latitude != null && item.longitude != null) {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap" title={formatCoords(item.latitude, item.longitude)}>
        <MapPin className="h-3 w-3 text-green-400 shrink-0" />
        {item.location_name || formatCoords(item.latitude, item.longitude)}
      </span>
    );
  }
  return <span className="text-muted-foreground/50">—</span>;
}

function StatusCell({ item }: { item: StorageMediaItem }) {
  return item.availability === "online" ? (
    <span className="flex items-center gap-1 text-green-400">
      <WifiHigh className="h-3 w-3 shrink-0" />Online
    </span>
  ) : (
    <span className="flex items-center gap-1 text-muted-foreground/60">
      <WifiSlash className="h-3 w-3 shrink-0" />Offline
    </span>
  );
}

function AiCell({ item }: { item: StorageMediaItem }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {item.llava_state === "done" && (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
          (item.llava_version ?? 0) >= 2
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-violet-500/15 text-violet-400"
        }`}>
          <Brain className="h-3 w-3 shrink-0" />
          {(item.llava_version ?? 0) >= 2 ? "Analyzed v2" : "Analyzed"}
        </span>
      )}
      {item.llava_state === "error" && (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-red-500/15 text-red-400">
          <Warning className="h-3 w-3 shrink-0" />Analysis error
        </span>
      )}
      {item.type === "video" && item.ai_state === "error" && (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-red-500/15 text-red-400">
          <Warning className="h-3 w-3 shrink-0" />Thumbnail error
        </span>
      )}
    </div>
  );
}

/** Standard header row matching the main files table, with optional extra columns */
function StorageTableHeader({
  hasCheckbox,
  onToggleAll,
  allChecked,
  extraColumns,
}: {
  hasCheckbox: boolean;
  onToggleAll?: () => void;
  allChecked?: boolean;
  extraColumns?: { label: string; className?: string }[];
}) {
  return (
    <TableHeader>
      <TableRow>
        {hasCheckbox && (
          <TableHead className="h-8 px-2 text-xs w-[40px]">
            <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
          </TableHead>
        )}
        <TableHead className="h-8 px-2 text-xs w-[48px]" />
        <TableHead className="h-8 px-2 text-xs">Filename</TableHead>
        {extraColumns?.map((col) => (
          <TableHead key={col.label} className={`h-8 px-2 text-xs ${col.className ?? ""}`}>{col.label}</TableHead>
        ))}
        <TableHead className="h-8 px-2 text-xs w-[120px]">Volume</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[60px]">Type</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[90px]">Size</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[100px]">Date Created</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[200px]">Location</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[70px]">Status</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[110px] text-center">AI</TableHead>
        <TableHead className="h-8 px-2 text-xs w-[70px]" />
      </TableRow>
    </TableHeader>
  );
}

/** Standard row cells matching the main files table, with checkbox + extra cells */
function StorageTableRow({
  item,
  checked,
  onToggle,
  extraCells,
}: {
  item: StorageMediaItem;
  checked: boolean;
  onToggle: () => void;
  extraCells?: React.ReactNode;
}) {
  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell className="px-2 py-1.5">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
      </TableCell>
      <TableCell className="px-2 py-1.5"><ThumbCell item={item} /></TableCell>
      <TableCell className="px-2 py-1.5 text-xs truncate max-w-[300px]" title={item.absolute_path}>
        {item.filename}
      </TableCell>
      {extraCells}
      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[120px]" title={item.volume_name ?? ""}>
        {item.volume_name ?? "—"}
      </TableCell>
      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
        .{item.file_ext.replace(/^\./, "").toLowerCase()}
      </TableCell>
      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
        {formatFileSize(item.size_bytes)}
      </TableCell>
      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
        {new Date(item.mtime_ms).toLocaleDateString()}
      </TableCell>
      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
        <LocationCell item={item} />
      </TableCell>
      <TableCell className="px-2 py-1.5 text-xs">
        <StatusCell item={item} />
      </TableCell>
      <TableCell className="px-2 py-1.5 text-center">
        <AiCell item={item} />
      </TableCell>
      <TableCell className="px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={(e) => { e.stopPropagation(); handleOpenInFinder(item.absolute_path); }}
        >
          <ArrowSquareOut className="mr-1 h-3.5 w-3.5" />
          Finder
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ── Large Files Tab ─────────────────────────────────────────────

function LargeFilesTab({ filters }: { filters: StorageFilters }) {
  const [minSize, setMinSize] = useState(100_000_000);
  const { data, isLoading } = useLargeFiles(minSize, 100, filters);
  const items = data?.items ?? [];
  const sel = useSelection(items);

  const sizeOptions = [
    { label: "50 MB", value: 50_000_000 },
    { label: "100 MB", value: 100_000_000 },
    { label: "500 MB", value: 500_000_000 },
    { label: "1 GB", value: 1_000_000_000 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Minimum size:</span>
        {sizeOptions.map((opt) => (
          <Button key={opt.value} size="sm" variant={minSize === opt.value ? "default" : "outline"} onClick={() => setMinSize(opt.value)}>
            {opt.label}
          </Button>
        ))}
      </div>
      <DeleteBar count={sel.selected.size} size={sel.selectedSize} onDelete={() => sel.setShowDelete(true)} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No files above {formatBytes(minSize)}</p>
      ) : (
        <Table>
          <StorageTableHeader hasCheckbox onToggleAll={sel.toggleAll} allChecked={items.length > 0 && sel.selected.size === items.length} />
          <TableBody>
            {items.map((item) => (
              <StorageTableRow key={item.id} item={item} checked={sel.selected.has(item.id)} onToggle={() => sel.toggle(item.id)} />
            ))}
          </TableBody>
        </Table>
      )}
      <DeleteDialog open={sel.showDelete} selectedIds={Array.from(sel.selected)} selectedSize={sel.selectedSize} onConfirm={sel.confirmDelete} onCancel={() => sel.setShowDelete(false)} isPending={sel.isDeleting} />
    </div>
  );
}

// ── Short Videos Tab ────────────────────────────────────────────

function ShortVideosTab({ filters }: { filters: StorageFilters }) {
  const [maxDuration, setMaxDuration] = useState(1.5);
  const { data, isLoading } = useShortVideos(maxDuration, filters);
  const items = data?.items ?? [];
  const sel = useSelection(items);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Max duration:</span>
        <Slider value={[maxDuration]} onValueChange={([v]) => setMaxDuration(v)} min={0.5} max={10} step={0.5} className="w-48" />
        <span className="text-sm font-mono w-12">{maxDuration}s</span>
      </div>
      <DeleteBar count={sel.selected.size} size={sel.selectedSize} onDelete={() => sel.setShowDelete(true)} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No videos shorter than {maxDuration}s found. Run a storage scan first.</p>
      ) : (
        <Table>
          <StorageTableHeader
            hasCheckbox
            onToggleAll={sel.toggleAll}
            allChecked={items.length > 0 && sel.selected.size === items.length}
            extraColumns={[{ label: "Duration", className: "w-[80px]" }]}
          />
          <TableBody>
            {items.map((item) => (
              <StorageTableRow
                key={item.id}
                item={item}
                checked={sel.selected.has(item.id)}
                onToggle={() => sel.toggle(item.id)}
                extraCells={
                  <TableCell className="px-2 py-1.5 text-xs font-mono text-muted-foreground">
                    {item.duration_sec != null ? formatDuration(item.duration_sec) : "—"}
                  </TableCell>
                }
              />
            ))}
          </TableBody>
        </Table>
      )}
      <DeleteDialog open={sel.showDelete} selectedIds={Array.from(sel.selected)} selectedSize={sel.selectedSize} onConfirm={sel.confirmDelete} onCancel={() => sel.setShowDelete(false)} isPending={sel.isDeleting} />
    </div>
  );
}

// ── Blurry Tab ──────────────────────────────────────────────────

function BlurryTab({ filters }: { filters: StorageFilters }) {
  const [maxBlur, setMaxBlur] = useState(100);
  const { data, isLoading } = useBlurry(maxBlur, filters);
  const items = data?.items ?? [];
  const sel = useSelection(items);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Max blur score:</span>
        <Slider value={[maxBlur]} onValueChange={([v]) => setMaxBlur(v)} min={10} max={500} step={10} className="w-48" />
        <span className="text-sm font-mono w-12">{maxBlur}</span>
      </div>
      <DeleteBar count={sel.selected.size} size={sel.selectedSize} onDelete={() => sel.setShowDelete(true)} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No blurry media found. Run a storage scan first.</p>
      ) : (
        <Table>
          <StorageTableHeader
            hasCheckbox
            onToggleAll={sel.toggleAll}
            allChecked={items.length > 0 && sel.selected.size === items.length}
            extraColumns={[{ label: "Blur", className: "w-[70px]" }]}
          />
          <TableBody>
            {items.map((item) => (
              <StorageTableRow
                key={item.id}
                item={item}
                checked={sel.selected.has(item.id)}
                onToggle={() => sel.toggle(item.id)}
                extraCells={
                  <TableCell className="px-2 py-1.5 text-xs font-mono text-muted-foreground">
                    {item.blur_score?.toFixed(0) ?? "—"}
                  </TableCell>
                }
              />
            ))}
          </TableBody>
        </Table>
      )}
      <DeleteDialog open={sel.showDelete} selectedIds={Array.from(sel.selected)} selectedSize={sel.selectedSize} onConfirm={sel.confirmDelete} onCancel={() => sel.setShowDelete(false)} isPending={sel.isDeleting} />
    </div>
  );
}

// ── Duplicates Tab ──────────────────────────────────────────────

function DuplicatesTab({ filters }: { filters: StorageFilters }) {
  const { data, isLoading } = useDuplicates(10, filters);
  const groups = data?.groups ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDelete, setShowDelete] = useState(false);
  const deleteMut = useDeleteStorageFiles();

  const allItems = groups.flat();
  const selectedSize = allItems
    .filter((i) => selected.has(i.id))
    .reduce((sum, i) => sum + i.size_bytes, 0);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmDelete = () => {
    deleteMut.mutate(Array.from(selected), {
      onSuccess: (res) => {
        toast.success(`Moved ${res.trashed} file${res.trashed !== 1 ? "s" : ""} to Trash (${formatBytes(res.freedBytes)} freed)`);
        setSelected(new Set());
        setShowDelete(false);
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
  };

  return (
    <div className="space-y-6">
      <DeleteBar count={selected.size} size={selectedSize} onDelete={() => setShowDelete(true)} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No duplicates found. Run a storage scan first.</p>
      ) : (
        groups.map((group, gi) => (
          <Card key={gi}>
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-3">
                Group {gi + 1} — {group.length} similar files
              </p>
              <Table>
                <StorageTableHeader hasCheckbox onToggleAll={undefined} allChecked={false} />
                <TableBody>
                  {group.map((item) => (
                    <TableRow key={item.id} className={`hover:bg-muted/50 cursor-pointer ${selected.has(item.id) ? "bg-destructive/5" : ""}`} onClick={() => toggle(item.id)}>
                      <TableCell className="px-2 py-1.5">
                        <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} onClick={(e) => e.stopPropagation()} />
                      </TableCell>
                      <TableCell className="px-2 py-1.5"><ThumbCell item={item} /></TableCell>
                      <TableCell className="px-2 py-1.5 text-xs truncate max-w-[300px]" title={item.absolute_path}>{item.filename}</TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[120px]" title={item.volume_name ?? ""}>{item.volume_name ?? "—"}</TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">.{item.file_ext.replace(/^\./, "").toLowerCase()}</TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">{formatFileSize(item.size_bytes)}</TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">{new Date(item.mtime_ms).toLocaleDateString()}</TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground"><LocationCell item={item} /></TableCell>
                      <TableCell className="px-2 py-1.5 text-xs"><StatusCell item={item} /></TableCell>
                      <TableCell className="px-2 py-1.5 text-center"><AiCell item={item} /></TableCell>
                      <TableCell className="px-2 py-1.5">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleOpenInFinder(item.absolute_path); }}>
                          <ArrowSquareOut className="mr-1 h-3.5 w-3.5" />Finder
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
      <DeleteDialog open={showDelete} selectedIds={Array.from(selected)} selectedSize={selectedSize} onConfirm={confirmDelete} onCancel={() => setShowDelete(false)} isPending={deleteMut.isPending} />
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────

const StorageHelper = () => {
  const statsQuery = useMediaStats();
  const extQuery = useMediaExtensions();
  const scanMutation = useScanDirectory();

  // Filter state
  const [volumeFilter, setVolumeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [extFilter, setExtFilter] = useState("all");

  const filters: StorageFilters = {
    volume: volumeFilter !== "all" ? volumeFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    file_ext: extFilter !== "all" ? extFilter : undefined,
  };
  const hasActiveFilters = volumeFilter !== "all" || typeFilter !== "all" || extFilter !== "all";

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <VideoSearchSidebar
          onScan={handleScan}
          videoCount={statsQuery.data?.total ?? 0}
          lastScanTime={scanMutation.isSuccess ? new Date() : null}
          isScanning={scanMutation.isPending}
          stats={statsQuery.data}
        />

        <SidebarInset>
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <SidebarTrigger />
            <Broom className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              Storage Helper
            </h1>
          </header>

          <div className="w-full px-6 py-6 space-y-6">
            <ScanProgress />

            {/* Filter bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={volumeFilter} onValueChange={setVolumeFilter}>
                <SelectTrigger className="w-40 text-xs">
                  <SelectValue placeholder="Volume" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drives</SelectItem>
                  {(statsQuery.data?.byVolume ?? []).map((v) => (
                    <SelectItem key={v.volume_name} value={v.volume_name}>
                      {v.volume_name} ({v.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-32 text-xs">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="video">Videos</SelectItem>
                  <SelectItem value="photo">Photos</SelectItem>
                </SelectContent>
              </Select>

              <Select value={extFilter} onValueChange={setExtFilter}>
                <SelectTrigger className="w-32 text-xs">
                  <SelectValue placeholder="Extension" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All extensions</SelectItem>
                  {(extQuery.data?.extensions ?? []).map((ext) => (
                    <SelectItem key={ext} value={ext}>
                      {ext.startsWith(".") ? ext : `.${ext}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => { setVolumeFilter("all"); setTypeFilter("all"); setExtFilter("all"); }}
                >
                  <X className="mr-1 h-3 w-3" />
                  Clear filters
                </Button>
              )}
            </div>

            <Tabs defaultValue="large" className="w-full">
              <TabsList>
                <TabsTrigger value="large" className="gap-1.5">
                  <HardDrive className="h-3.5 w-3.5" />
                  Large Files
                </TabsTrigger>
                <TabsTrigger value="short" className="gap-1.5">
                  <FilmStrip className="h-3.5 w-3.5" />
                  Short Videos
                </TabsTrigger>
                <TabsTrigger value="blurry" className="gap-1.5">
                  <ImageBroken className="h-3.5 w-3.5" />
                  Blurry
                </TabsTrigger>
                <TabsTrigger value="duplicates" className="gap-1.5">
                  <CopySimple className="h-3.5 w-3.5" />
                  Duplicates
                </TabsTrigger>
              </TabsList>

              <TabsContent value="large" className="mt-4"><LargeFilesTab filters={filters} /></TabsContent>
              <TabsContent value="short" className="mt-4"><ShortVideosTab filters={filters} /></TabsContent>
              <TabsContent value="blurry" className="mt-4"><BlurryTab filters={filters} /></TabsContent>
              <TabsContent value="duplicates" className="mt-4"><DuplicatesTab filters={filters} /></TabsContent>
            </Tabs>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default StorageHelper;
