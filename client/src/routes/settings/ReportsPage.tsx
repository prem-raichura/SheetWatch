import { useCallback, useEffect, useState } from "react";
import { FileBarChart, Plus, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Project } from "@/types";
import { useToast } from "@/components/Toast";
import Spinner from "@/components/Spinner";

interface Report {
  id: string;
  cadence: "daily" | "weekly";
  dayOfWeek: number;
  hour: number;
  format: "pdf" | "csv" | "both";
  projectId: string | null;
  enabled: boolean;
  lastSentAt: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const field =
  "rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

// Scheduled email summaries: changes + KPI values as PDF/CSV attachments.
export default function ReportsPage() {
  const toast = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refetch = useCallback(() => {
    api
      .get<Report[]>("/api/reports")
      .then(setReports)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    api.get<Project[]>("/api/projects").then(setProjects).catch(() => {});
  }, [refetch]);

  const create = async () => {
    setBusy("create");
    try {
      await api.post("/api/reports", { cadence: "weekly", dayOfWeek: 1, hour: 8, format: "pdf" });
      refetch();
      toast.success("Report scheduled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create report");
    } finally {
      setBusy(null);
    }
  };

  const patch = async (id: string, data: Partial<Report>) => {
    try {
      await api.patch(`/api/reports/${id}`, data);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t save");
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/api/reports/${id}`);
      refetch();
      toast.success("Report removed");
    } catch {
      toast.error("Couldn’t remove report");
    }
  };

  const sendNow = async (id: string) => {
    setBusy(id);
    try {
      await api.post(`/api/reports/${id}/send-now`);
      refetch();
      toast.success("Report sent — check your inbox");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed (is email configured?)");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold text-ink-900">Scheduled reports</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              A change + KPI summary mailed on your schedule, as PDF and/or CSV. Needs email
              configured on the server.
            </p>
          </div>
          <button
            onClick={create}
            disabled={busy === "create"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {busy === "create" ? <Spinner /> : <Plus className="h-3.5 w-3.5" />} New schedule
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="font-mono text-xs text-ink-300">loading…</p>
          ) : reports.length === 0 ? (
            <p className="font-mono text-xs text-ink-300">
              no schedules yet — weekly Monday 8:00 is a good start
            </p>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileBarChart className="h-4 w-4 text-ink-400" />
                  <select
                    value={r.cadence}
                    onChange={(e) => patch(r.id, { cadence: e.target.value as Report["cadence"] })}
                    className={field}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  {r.cadence === "weekly" && (
                    <select
                      value={r.dayOfWeek}
                      onChange={(e) => patch(r.id, { dayOfWeek: Number(e.target.value) })}
                      className={field}
                    >
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={r.hour}
                    onChange={(e) => patch(r.id, { hour: Number(e.target.value) })}
                    className={field}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                  <select
                    value={r.format}
                    onChange={(e) => patch(r.id, { format: e.target.value as Report["format"] })}
                    className={field}
                  >
                    <option value="pdf">PDF</option>
                    <option value="csv">CSV</option>
                    <option value="both">PDF + CSV</option>
                  </select>
                  <select
                    value={r.projectId ?? ""}
                    onChange={(e) => patch(r.id, { projectId: e.target.value || null })}
                    className={field}
                  >
                    <option value="">All sheets</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => patch(r.id, { enabled: !r.enabled })}
                      aria-pressed={r.enabled}
                      className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                        r.enabled ? "bg-teal-soft text-teal-600" : "bg-secondary text-ink-400"
                      }`}
                    >
                      {r.enabled ? "on" : "off"}
                    </button>
                    <button
                      onClick={() => sendNow(r.id)}
                      disabled={busy === r.id}
                      aria-label="Send now"
                      title="Send now"
                      className="rounded-lg border border-line bg-surface p-1.5 text-ink-400 shadow-xs transition-all hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
                    >
                      {busy === r.id ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      aria-label="Delete schedule"
                      className="rounded-lg border border-line bg-surface p-1.5 text-ink-400 shadow-xs transition-all hover:border-coral/50 hover:bg-coral-soft hover:text-coral-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {r.lastSentAt && (
                  <p className="mt-2 font-mono text-[10px] text-ink-300">
                    last sent {new Date(r.lastSentAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
