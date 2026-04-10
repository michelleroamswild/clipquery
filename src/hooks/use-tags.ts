import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchTags,
  createTag,
  deleteTag,
  fetchItemTags,
  addItemTag,
  removeItemTag,
  bulkAddTag,
} from "@/lib/api-client";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: fetchTags,
    select: (data) => data.tags,
  });
}

export function useItemTags(mediaId: number | undefined) {
  return useQuery({
    queryKey: ["item-tags", mediaId],
    queryFn: () => fetchItemTags(mediaId!),
    enabled: !!mediaId,
    select: (data) => data.tags,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) =>
      createTag(name, color),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["item-tags"] });
    },
  });
}

export function useAddItemTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      mediaId,
      tag,
    }: {
      mediaId: number;
      tag: { tagId?: number; name?: string; color?: string };
    }) => addItemTag(mediaId, tag),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["item-tags", variables.mediaId] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useRemoveItemTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, tagId }: { mediaId: number; tagId: number }) =>
      removeItemTag(mediaId, tagId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["item-tags", variables.mediaId] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useBulkAddTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, mediaIds }: { tagId: number; mediaIds: number[] }) =>
      bulkAddTag(tagId, mediaIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["item-tags"] });
    },
  });
}
