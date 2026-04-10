import { useState } from "react";
import {
  ArrowSquareOut, ArrowUp, ArrowDown, Folders, Image, Plus, Pencil, Trash, X,
} from "@phosphor-icons/react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { VideoSearchSidebar } from "@/components/VideoSearchSidebar";
import { MediaDetailSheet } from "@/components/MediaDetailSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { thumbnailUrl, openInFinder } from "@/lib/api-client";
import { formatFileSize } from "@/lib/mock-data";
import { useMediaStats } from "@/hooks/use-media";
import { useScanDirectory } from "@/hooks/use-scan";
import {
  useCollections,
  useCollectionDetail,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useRemoveFromCollection,
  useReorderCollectionItems,
} from "@/hooks/use-collections";
import type { MediaItemRow } from "@/lib/api-client";

const Collections = () => {
  const statsQuery = useMediaStats();
  const scanMutation = useScanDirectory();
  const collectionsQuery = useCollections();
  const collections = collectionsQuery.data ?? [];

  const [selectedCollectionId, setSelectedCollectionId] = useState<number | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogDescription, setDialogDescription] = useState("");
  const [selectedItem, setSelectedItem] = useState<MediaItemRow | null>(null);

  const detailQuery = useCollectionDetail(selectedCollectionId);
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const removeFromCollection = useRemoveFromCollection();
  const reorderItems = useReorderCollectionItems();

  const collectionItems = (detailQuery.data?.items ?? []) as (MediaItemRow & {
    position: number;
    collection_added_at: string;
  })[];

  const handleScan = async (dirPath: string) => {
    await scanMutation.mutateAsync([dirPath]);
  };

  const openCreateDialog = () => {
    setEditingId(null);
    setDialogName("");
    setDialogDescription("");
    setDialogOpen(true);
  };

  const openEditDialog = (c: { id: number; name: string; description: string | null }) => {
    setEditingId(c.id);
    setDialogName(c.name);
    setDialogDescription(c.description ?? "");
    setDialogOpen(true);
  };

  const handleSaveCollection = () => {
    if (!dialogName.trim()) return;
    if (editingId) {
      updateCollection.mutate({
        id: editingId,
        data: { name: dialogName.trim(), description: dialogDescription.trim() || undefined },
      });
    } else {
      createCollection.mutate(
        { name: dialogName.trim(), description: dialogDescription.trim() || undefined },
        {
          onSuccess: (c) => setSelectedCollectionId(c.id),
        }
      );
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: number) => {
    deleteCollection.mutate(id);
    if (selectedCollectionId === id) setSelectedCollectionId(undefined);
  };

  const handleMoveItem = (index: number, direction: -1 | 1) => {
    if (!selectedCollectionId) return;
    const ids = collectionItems.map((i) => i.id);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= ids.length) return;
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    reorderItems.mutate({ collectionId: selectedCollectionId, orderedIds: ids });
  };

  const selectedCollection = collections.find((c) => c.id === selectedCollectionId);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <VideoSearchSidebar
          onScan={handleScan}
          videoCount={statsQuery.data?.total ?? 0}
          lastScanTime={null}
          isScanning={scanMutation.isPending}
          stats={statsQuery.data}
        />

        <SidebarInset>
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <SidebarTrigger />
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              Collections
            </h1>
          </header>

          <div className="flex flex-1 h-[calc(100vh-57px)]">
            {/* Left panel — collection list */}
            <div className="w-72 border-r border-border flex flex-col shrink-0">
              <div className="px-3 py-3 border-b border-border">
                <Button size="sm" className="w-full text-xs" onClick={openCreateDialog}>
                  <Plus className="h-3 w-3 mr-1" />
                  New Collection
                </Button>
              </div>
              <ScrollArea className="flex-1">
                {collections.length === 0 ? (
                  <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                    <Folders className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    No collections yet. Create one to get started.
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {collections.map((c) => (
                      <button
                        key={c.id}
                        className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                          selectedCollectionId === c.id
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedCollectionId(c.id)}
                      >
                        <div className="truncate">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {c.itemCount} item{c.itemCount !== 1 ? "s" : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right panel — collection detail */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedCollection ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  {collections.length > 0
                    ? "Select a collection to view its items"
                    : "Create a collection to get started"}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-sm font-semibold truncate">{selectedCollection.name}</h2>
                      {selectedCollection.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {selectedCollection.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => openEditDialog(selectedCollection)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                      onClick={() => handleDelete(selectedCollection.id)}
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {collectionItems.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                      This collection is empty. Add items from the Files page.
                    </div>
                  ) : (
                    <ScrollArea className="flex-1">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8 px-2 text-xs w-[48px]" />
                            <TableHead className="h-8 px-2 text-xs">Filename</TableHead>
                            <TableHead className="h-8 px-2 text-xs w-[60px]">Type</TableHead>
                            <TableHead className="h-8 px-2 text-xs w-[90px]">Size</TableHead>
                            <TableHead className="h-8 px-2 text-xs w-[60px]">Order</TableHead>
                            <TableHead className="h-8 px-2 text-xs w-[120px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {collectionItems.map((item, index) => {
                            const thumb = thumbnailUrl(item);
                            return (
                              <TableRow
                                key={item.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setSelectedItem(item)}
                              >
                                <TableCell className="px-2 py-1.5">
                                  {thumb ? (
                                    <img
                                      src={thumb}
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
                                <TableCell className="px-2 py-1.5 text-xs truncate max-w-[300px]" title={item.absolute_path}>
                                  {item.filename}
                                </TableCell>
                                <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
                                  {item.file_ext}
                                </TableCell>
                                <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
                                  {formatFileSize(item.size_bytes)}
                                </TableCell>
                                <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0"
                                      disabled={index === 0}
                                      onClick={() => handleMoveItem(index, -1)}
                                    >
                                      <ArrowUp className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0"
                                      disabled={index === collectionItems.length - 1}
                                      onClick={() => handleMoveItem(index, 1)}
                                    >
                                      <ArrowDown className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={async () => {
                                        try {
                                          await openInFinder(item.absolute_path);
                                        } catch {
                                          toast({ title: "Error", description: "Failed to open in Finder.", duration: 5000 });
                                        }
                                      }}
                                    >
                                      <ArrowSquareOut className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                                      onClick={() => {
                                        removeFromCollection.mutate({
                                          collectionId: selectedCollectionId!,
                                          mediaId: item.id,
                                        });
                                      }}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </>
              )}
            </div>
          </div>
        </SidebarInset>

        <MediaDetailSheet
          item={selectedItem}
          items={collectionItems}
          open={selectedItem !== null}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
        />

        {/* Create / Edit dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Collection" : "New Collection"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Input
                placeholder="Collection name"
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                autoFocus
              />
              <Textarea
                placeholder="Description (optional)"
                value={dialogDescription}
                onChange={(e) => setDialogDescription(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCollection} disabled={!dialogName.trim()}>
                {editingId ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SidebarProvider>
  );
};

export default Collections;
