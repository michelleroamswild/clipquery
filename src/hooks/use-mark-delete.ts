import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setMarkedForDelete } from "@/lib/api-client";

export function useSetMarkedForDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, marked }: { id: number; marked: boolean }) =>
      setMarkedForDelete(id, marked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
    },
  });
}
