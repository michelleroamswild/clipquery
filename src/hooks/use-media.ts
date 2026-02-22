import { useQuery } from "@tanstack/react-query";
import {
  fetchMediaList,
  fetchMediaStats,
  fetchMediaExtensions,
  fetchDashboard,
  type MediaListParams,
} from "@/lib/api-client";

export function useMediaList(params: MediaListParams = {}) {
  return useQuery({
    queryKey: ["media", params],
    queryFn: () => fetchMediaList(params),
  });
}

export function useMediaStats() {
  return useQuery({
    queryKey: ["media-stats"],
    queryFn: fetchMediaStats,
  });
}

export function useMediaExtensions() {
  return useQuery({
    queryKey: ["media-extensions"],
    queryFn: fetchMediaExtensions,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
}
