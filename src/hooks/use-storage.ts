import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchStorageScanStatus,
  startStorageScan,
  stopStorageScan,
  fetchDuplicates,
  fetchShortVideos,
  fetchBlurry,
  fetchLargeFiles,
  deleteStorageFiles,
  type StorageFilters,
} from "@/lib/api-client";

export function useStorageScanStatus(pollInterval?: number | false) {
  return useQuery({
    queryKey: ["storage-scan-status"],
    queryFn: fetchStorageScanStatus,
    refetchInterval: pollInterval,
  });
}

export function useStartStorageScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startStorageScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["storage-scan-status"] }),
  });
}

export function useStopStorageScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: stopStorageScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["storage-scan-status"] }),
  });
}

export function useDuplicates(threshold?: number, filters?: StorageFilters) {
  return useQuery({
    queryKey: ["storage-duplicates", threshold, filters],
    queryFn: () => fetchDuplicates(threshold, filters),
  });
}

export function useShortVideos(maxDuration?: number, filters?: StorageFilters) {
  return useQuery({
    queryKey: ["storage-short-videos", maxDuration, filters],
    queryFn: () => fetchShortVideos(maxDuration, filters),
  });
}

export function useBlurry(maxBlur?: number, filters?: StorageFilters) {
  return useQuery({
    queryKey: ["storage-blurry", maxBlur, filters],
    queryFn: () => fetchBlurry(maxBlur, filters),
  });
}

export function useLargeFiles(minSize?: number, limit?: number, filters?: StorageFilters) {
  return useQuery({
    queryKey: ["storage-large", minSize, limit, filters],
    queryFn: () => fetchLargeFiles(minSize, limit, filters),
  });
}

export function useDeleteStorageFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteStorageFiles,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-duplicates"] });
      qc.invalidateQueries({ queryKey: ["storage-short-videos"] });
      qc.invalidateQueries({ queryKey: ["storage-blurry"] });
      qc.invalidateQueries({ queryKey: ["storage-large"] });
      qc.invalidateQueries({ queryKey: ["media"] });
      qc.invalidateQueries({ queryKey: ["media-stats"] });
    },
  });
}
