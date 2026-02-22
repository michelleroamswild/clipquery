import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchFolders,
  updateFolderLocation,
  type FolderLocationUpdateParams,
} from "@/lib/api-client";

export function useFolders(volume: string, parent?: string, enabled = true) {
  return useQuery({
    queryKey: ["folders", volume, parent ?? null],
    queryFn: () => fetchFolders(volume, parent),
    enabled: enabled && !!volume,
  });
}

export function useUpdateFolderLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: FolderLocationUpdateParams) =>
      updateFolderLocation(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}
