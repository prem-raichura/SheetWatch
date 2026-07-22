import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CompareGroup, CompareSuggestion } from "../types";
import { useRealtimeRefetch } from "./useRealtimeRefetch";

export interface NewGroup {
  name: string;
  masterSheetId: string;
  targetSheetIds: string[];
  keyColumn: string | null;
  compareColumns: string[];
}

export interface ApplyResult {
  applied: number;
  failed: number;
}

// Comparison groups + the mutations the Compare tab needs. Suggestions are
// fetched per-group by the tab (status/search filtered), so they live there.
export function useCompare() {
  const [groups, setGroups] = useState<CompareGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setGroups(await api.get<CompareGroup[]>("/api/compare/groups"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comparisons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const t = setInterval(refetch, 30_000);
    return () => clearInterval(t);
  }, [refetch]);
  useRealtimeRefetch(refetch);

  const createGroup = (g: NewGroup) => api.post<{ id: string }>("/api/compare/groups", g);
  const updateGroup = (id: string, patch: Partial<NewGroup> & { enabled?: boolean }) =>
    api.patch(`/api/compare/groups/${id}`, patch);
  const deleteGroup = (id: string) => api.delete(`/api/compare/groups/${id}`);
  const runGroup = (id: string) =>
    api.post<CompareSuggestion[]>(`/api/compare/groups/${id}/run`);
  const getColumns = (id: string) =>
    api.get<{ columns: string[] }>(`/api/compare/groups/${id}/columns`);

  const accept = (ids: string[]) =>
    api.post<ApplyResult>("/api/compare/suggestions/accept", { ids });
  const acceptAll = (id: string, excludeConflicts: boolean) =>
    api.post<ApplyResult>(`/api/compare/groups/${id}/accept-all`, { excludeConflicts });
  const ignore = (ids: string[]) =>
    api.post<{ ignored: number }>("/api/compare/suggestions/ignore", { ids });

  return {
    groups,
    loading,
    error,
    refetch,
    createGroup,
    updateGroup,
    deleteGroup,
    runGroup,
    getColumns,
    accept,
    acceptAll,
    ignore,
  };
}

// Fetch one group's suggestions with an optional status + free-text filter.
export function fetchSuggestions(groupId: string, status: string, q: string) {
  const params = new URLSearchParams({ status, q });
  return api.get<CompareSuggestion[]>(`/api/compare/groups/${groupId}/suggestions?${params}`);
}
