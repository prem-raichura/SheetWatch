import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

// Total pending compare suggestions, for the nav badge. Refreshes on realtime
// events and on a slow interval so accepting/ignoring elsewhere settles quickly.
export function useComparePending() {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>("/api/compare/pending-count");
      setCount(count);
    } catch {
      // non-fatal — badge just won't show
    }
  }, []);

  useEffect(() => {
    refetch();
    const t = setInterval(refetch, 30_000);
    return () => clearInterval(t);
  }, [refetch]);
  useRealtimeRefetch(refetch);

  return count;
}
