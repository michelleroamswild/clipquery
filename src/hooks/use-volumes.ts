import { useQuery } from "@tanstack/react-query";
import { fetchVolumes } from "@/lib/api-client";

export function useVolumes() {
  return useQuery({
    queryKey: ["volumes"],
    queryFn: fetchVolumes,
    refetchInterval: 10_000,
  });
}
