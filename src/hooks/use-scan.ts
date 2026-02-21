import { useMutation, useQueryClient } from "@tanstack/react-query";
import { scanDirectories } from "@/lib/api-client";

export function useScanDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (directories: string[]) => scanDirectories(directories),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["media-stats"] });
    },
  });
}
