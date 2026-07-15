import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { ChangeLogWithSheet } from "../types";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

// Server-backed unread changes for the notification bell. Polls lightly and
// refreshes when the tab regains focus.
export function useUnread() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<ChangeLogWithSheet[]>([]);

  const refetch = useCallback(async () => {
    try {
      const [{ count }, items] = await Promise.all([
        api.get<{ count: number }>("/api/changes/unread-count"),
        api.get<ChangeLogWithSheet[]>("/api/changes/unread"),
      ]);
      setCount(count);
      setItems(items);
    } catch {
      // non-fatal — bell just stays stale
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  useRealtimeRefetch(refetch);

  const markRead = useCallback(
    async (ids?: string[]) => {
      try {
        await api.post("/api/changes/mark-read", ids ? { ids } : {});
        await refetch();
      } catch {
        // ignore
      }
    },
    [refetch]
  );

  return { count, items, refetch, markRead };
}
