import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { Project } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const data = await api.get<Project[]>("/api/projects");
      setProjects(data);
    } catch {
      // non-fatal — grouping just won't show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createProject = (name: string, color: string) =>
    api.post<Project>("/api/projects", { name, color });

  const updateProject = (id: string, patch: Partial<Project> & { applyNotifyToSheets?: boolean }) =>
    api.patch<Project>(`/api/projects/${id}`, patch);

  const deleteProject = (id: string) => api.delete(`/api/projects/${id}`);

  return { projects, loading, refetch, createProject, updateProject, deleteProject };
}
