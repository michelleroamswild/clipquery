import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  fetchCollectionDetail,
  addToCollection,
  removeFromCollection,
  reorderCollectionItems,
} from "@/lib/api-client";

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
    select: (data) => data.collections,
  });
}

export function useCollectionDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["collection-detail", id],
    queryFn: () => fetchCollectionDetail(id!),
    enabled: !!id,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createCollection(name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export function useUpdateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; description?: string };
    }) => updateCollection(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["collection-detail", variables.id] });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export function useAddToCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      collectionId,
      mediaIds,
    }: {
      collectionId: number;
      mediaIds: number[];
    }) => addToCollection(collectionId, mediaIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({
        queryKey: ["collection-detail", variables.collectionId],
      });
    },
  });
}

export function useRemoveFromCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      collectionId,
      mediaId,
    }: {
      collectionId: number;
      mediaId: number;
    }) => removeFromCollection(collectionId, mediaId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({
        queryKey: ["collection-detail", variables.collectionId],
      });
    },
  });
}

export function useReorderCollectionItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      collectionId,
      orderedIds,
    }: {
      collectionId: number;
      orderedIds: number[];
    }) => reorderCollectionItems(collectionId, orderedIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["collection-detail", variables.collectionId],
      });
    },
  });
}
