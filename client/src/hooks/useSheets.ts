import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { Sheet } from "../types";

export function useSheets() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await api.get<Sheet[]>("/api/sheets");
      setSheets(data);
      setError(null);
    } catch {
      setError("Failed to load sheets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return { sheets, loading, error, refetch };
}
