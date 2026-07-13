import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { Webhook, WebhookKind } from "../types";

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const data = await api.get<Webhook[]>("/api/webhooks");
      setWebhooks(data);
    } catch {
      // non-fatal — webhook options just won't show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createWebhook = (kind: WebhookKind, url: string, label: string) =>
    api.post<Webhook>("/api/webhooks", { kind, url, label });

  const deleteWebhook = (id: string) => api.delete(`/api/webhooks/${id}`);

  const testWebhook = (id: string) => api.post(`/api/webhooks/${id}/test`);

  return { webhooks, loading, refetch, createWebhook, deleteWebhook, testWebhook };
}
