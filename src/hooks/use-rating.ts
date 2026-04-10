import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setRating } from "@/lib/api-client";

export function useSetRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: number }) =>
      setRating(id, rating),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
