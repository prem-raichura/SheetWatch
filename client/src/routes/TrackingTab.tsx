import { useState } from "react";
import { Link } from "react-router-dom";
import { useSheets } from "../hooks/useSheets";
import { useProjects } from "../hooks/useProjects";
import SheetRow from "../components/SheetRow";
import BlurFade from "../components/magic/BlurFade";
import ProjectModal from "../components/ProjectModal";
import AddSheetsModal from "../components/AddSheetsModal";
import WebhooksModal from "../components/WebhooksModal";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";
import { Project, Sheet } from "../types";
import { api } from "../lib/api";

export default function TrackingTab() {
  const { sheets, loading, error, refetch } = useSheets();
  const { projects, refetch: refetchProjects, createProject, updateProject, deleteProject } =
    useProjects();
  const toast = useToast();

  const [filter, setFilter] = useState<string>("all"); // "all" | "ungrouped" | projectId
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ open: boolean; project: Project | null }>({
    open: false,
    project: null,
  });
  const [addTo, setAddTo] = useState<Project | null>(null);
  const [webhooksOpen, setWebhooksOpen] = useState(false);

  const refetchAll = () => {
    refetch();
    refetchProjects();
  };

  const q = query.trim().toLowerCase();
  const byProject = (id: string | null) =>
    sheets.filter(
      (s) => (s.projectId ?? null) === id && (!q || s.label.toLowerCase().includes(q))
    );

  const bulk = async (p: Project, action: "pause" | "resume" | "check") => {
    try {
      const { affected } = await api.post<{ affected: number }>(
        `/api/projects/${p.id}/bulk`,
        { action }
      );
      const verb =
        action === "pause" ? "paused" : action === "resume" ? "resumed" : "checking";
      toast.success(`${verb} ${affected} sheet${affected !== 1 ? "s" : ""} in “${p.name}”`);
      if (action === "check") setTimeout(refetchAll, 2500);
      else refetchAll();
    } catch {
      toast.error("Bulk action failed");
    }
  };

  const moveProject = async (index: number, dir: -1 | 1) => {
    const target = projects[index + dir];
    const current = projects[index];
    if (!target || !current) return;
    await Promise.all([
      updateProject(current.id, { sortOrder: target.sortOrder }),
      updateProject(target.id, { sortOrder: current.sortOrder }),
    ]);
    refetchProjects();
  };

  const chip = (key: string, label: string, color?: string, count?: number) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        filter === key
          ? "border-foreground bg-foreground text-background"
          : "border-line bg-surface text-ink-500 hover:text-ink-900"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
      {count !== undefined && (
        <span className={filter === key ? "text-background/60" : "text-ink-300"}>{count}</span>
      )}
    </button>
  );

  const renderSheets = (list: Sheet[]) =>
    list.length === 0 ? (
      <p className="pl-1 font-mono text-xs text-ink-300">no sheets here</p>
    ) : (
      <div className="space-y-3">
        {list.map((s, i) => (
          <BlurFade key={s.id} delay={Math.min(i, 8) * 0.04}>
            <SheetRow sheet={s} projects={projects} onUpdated={refetchAll} />
          </BlurFade>
        ))}
      </div>
    );

  const showProject = (p: Project, index: number) => {
    if (filter !== "all" && filter !== p.id) return null;
    const members = byProject(p.id);
    const anyActive = members.some((s) => !s.paused);
    return (
      <section key={p.id} className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <h2 className="font-display text-sm font-bold text-ink-900">{p.name}</h2>
          <span className="font-mono text-[11px] text-ink-400">{byProject(p.id).length}</span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button
              onClick={() => setAddTo(p)}
              className="rounded-md bg-teal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-600 transition-colors hover:bg-teal hover:text-primary-foreground"
            >
              + add sheet
            </button>
            {members.length > 0 && (
              <>
                <button
                  onClick={() => bulk(p, "check")}
                  disabled={!anyActive}
                  className="rounded-md px-2 py-0.5 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-teal-600 disabled:opacity-30"
                  title="Check all sheets in this project now"
                >
                  ↻ check all
                </button>
                <button
                  onClick={() => bulk(p, anyActive ? "pause" : "resume")}
                  className="rounded-md px-2 py-0.5 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
                  title={anyActive ? "Pause all sheets in this project" : "Resume all sheets in this project"}
                >
                  {anyActive ? "❚❚ pause all" : "▶ resume all"}
                </button>
              </>
            )}
            <button
              onClick={() => moveProject(index, -1)}
              disabled={index === 0}
              aria-label={`Move ${p.name} up`}
              className="rounded-md px-1.5 py-0.5 text-ink-300 transition-colors hover:bg-paper hover:text-ink-700 disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              onClick={() => moveProject(index, 1)}
              disabled={index === projects.length - 1}
              aria-label={`Move ${p.name} down`}
              className="rounded-md px-1.5 py-0.5 text-ink-300 transition-colors hover:bg-paper hover:text-ink-700 disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
            <button
              onClick={() => setModal({ open: true, project: p })}
              aria-label={`Edit ${p.name}`}
              className="rounded-md px-2 py-0.5 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
            >
              edit
            </button>
          </div>
        </div>
        {renderSheets(members)}
      </section>
    );
  };

  const ungrouped = byProject(null);

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Tracking</h1>
          <p className="mt-1 text-sm text-ink-500">
            Watched on a schedule. Group into projects, tune what each one watches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWebhooksOpen(true)}
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-700 shadow-xs transition-all hover:text-ink-900 active:scale-[0.97]"
          >
            ⚡ Webhooks
          </button>
          <button
            onClick={() => setModal({ open: true, project: null })}
            className="rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/85 active:scale-[0.97]"
          >
            + New project
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : error ? (
        <div className="rounded-2xl border border-coral/30 bg-coral-soft px-5 py-4">
          <p className="text-sm font-medium text-coral-600">{error}</p>
        </div>
      ) : sheets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink-700">Nothing tracked yet</p>
          <p className="mt-1 text-sm text-ink-400">
            Head to{" "}
            <Link to="/sheets" className="font-medium text-teal-600 hover:underline">
              Sheets
            </Link>{" "}
            and track your first one.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {chip("all", "All", undefined, sheets.length)}
            {projects.map((p) => chip(p.id, p.name, p.color, byProject(p.id).length))}
            {ungrouped.length > 0 && chip("ungrouped", "Ungrouped", undefined, ungrouped.length)}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search tracked sheets"
              className="ml-auto w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
            />
          </div>

          <div className="space-y-8">
            {projects.map((p, i) => showProject(p, i))}

            {(filter === "all" || filter === "ungrouped") && ungrouped.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
                  <h2 className="font-display text-sm font-bold text-ink-500">Ungrouped</h2>
                  <span className="font-mono text-[11px] text-ink-400">{ungrouped.length}</span>
                </div>
                {renderSheets(ungrouped)}
              </section>
            )}
          </div>
        </>
      )}

      {modal.open && (
        <ProjectModal
          project={modal.project}
          onClose={() => setModal({ open: false, project: null })}
          onSave={async (data) => {
            if (modal.project) {
              await updateProject(modal.project.id, data);
              toast.success("Project saved");
            } else {
              await createProject(data.name, data.color);
              toast.success(`Created “${data.name}”`);
            }
            refetchAll();
          }}
          onDelete={
            modal.project
              ? async () => {
                  await deleteProject(modal.project!.id);
                  toast.success("Project deleted");
                  refetchAll();
                }
              : undefined
          }
        />
      )}

      {webhooksOpen && (
        <WebhooksModal onClose={() => setWebhooksOpen(false)} onChanged={refetchAll} />
      )}

      {addTo && (
        <AddSheetsModal
          projectId={addTo.id}
          projectName={addTo.name}
          onClose={() => setAddTo(null)}
          onDone={refetchAll}
        />
      )}
    </div>
  );
}
