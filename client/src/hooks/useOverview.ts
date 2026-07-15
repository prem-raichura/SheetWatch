import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { Overview } from "../types";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

export function useOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setOverview(await api.get<Overview>("/api/overview"));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  useRealtimeRefetch(refetch);

  return { overview, loading, refetch };
}
