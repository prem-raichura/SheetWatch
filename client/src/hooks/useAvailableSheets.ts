import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { AvailableSheet } from "../types";

export function useAvailableSheets() {
  const [available, setAvailable] = useState<AvailableSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await api.get<AvailableSheet[]>("/api/sheets/available");
      setAvailable(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list your sheets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { available, loading, error, refetch };
}
