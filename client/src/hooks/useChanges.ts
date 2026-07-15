import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { ChangeLogWithSheet } from "../types";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

export function useChanges(q = "", pollMs = 30_000) {
  const [changes, setChanges] = useState<ChangeLogWithSheet[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      setChanges(await api.get<ChangeLogWithSheet[]>(`/api/changes${query}`));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    setLoading(true);
    refetch();
    const interval = setInterval(refetch, pollMs);
    return () => clearInterval(interval);
  }, [refetch, pollMs]);

  useRealtimeRefetch(refetch);

  return { changes, loading, refetch };
}
