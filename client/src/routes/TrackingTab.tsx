import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GripVertical, LayoutGrid, List } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSheets } from "../hooks/useSheets";
import { useProjects } from "../hooks/useProjects";
import SheetRow from "../components/SheetRow";
import SheetListRow from "../components/SheetListRow";
import ViewToggle from "../components/ViewToggle";
import BlurFade from "../components/magic/BlurFade";
import ProjectModal from "../components/ProjectModal";
import AddSheetsModal from "../components/AddSheetsModal";
import WebhooksModal from "../components/WebhooksModal";
import { useToast } from "../components/Toast";
import { SkeletonRows } from "../components/Skeleton";
import { usePrefs } from "../providers/PrefsProvider";
import { Project, Sheet } from "../types";
import { api } from "../lib/api";

const UNGROUPED = "ungrouped";
type View = "cards" | "list";
type Board = Record<string, string[]>;

// Ordered sheet ids per container, straight from the server order.
function buildBoard(sheets: Sheet[], projects: Project[]): Board {
  const board: Board = { [UNGROUPED]: [] };
  for (const p of projects) board[p.id] = [];
  for (const s of sheets) {
    const key = s.projectId ?? UNGROUPED;
    (board[key] ??= []).push(s.id);
  }
  return board;
}

const projectIdOf = (container: string) => (container === UNGROUPED ? null : container);

// One draggable sheet — grip is the only handle so the row's own buttons keep
// working. Renders a card or a compact row per the current view.
function SortableSheet({
  sheet,
  container,
  view,
  projects,
  onUpdated,
}: {
  sheet: Sheet;
  container: string;
  view: View;
  projects: Project[];
  onUpdated: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sheet.id,
    data: { type: "sheet", container },
  });
  // Match the dashboard "edit layout" dragger: the row itself moves under the
  // cursor (no DragOverlay ghost), lifted and on top while dragging.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
  };
  const grip = (
    <button
      aria-label={`Drag ${sheet.label}`}
      className="cursor-grab text-ink-300 transition-colors hover:text-ink-500 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  if (view === "list") {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-1 pl-2">
        {grip}
        <div className="min-w-0 flex-1">
          <SheetListRow sheet={sheet} projects={projects} onUpdated={onUpdated} />
        </div>
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style} className="flex gap-1">
      <div className="pt-4">{grip}</div>
      <div className="min-w-0 flex-1">
        <SheetRow sheet={sheet} projects={projects} onUpdated={onUpdated} />
      </div>
    </div>
  );
}

// Drop target wrapper for a group, so sheets can be dropped into empty groups
// and across group boundaries.
function GroupList({
  container,
  view,
  children,
  empty,
}: {
  container: string;
  view: View;
  children: ReactNode;
  empty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `container:${container}`,
    data: { type: "container", container },
  });
  const ring = isOver ? "ring-2 ring-teal/40" : "";
  if (view === "list") {
    return (
      <div
        ref={setNodeRef}
        className={`divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card ${ring} ${
          empty ? "px-3 py-4" : ""
        }`}
      >
        {empty ? <p className="font-mono text-xs text-ink-300">drop a sheet here</p> : children}
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className={`space-y-3 rounded-2xl ${ring} ${empty ? "p-3" : ""}`}>
      {empty ? (
        <p className="pl-1 font-mono text-xs text-ink-300">drop a sheet here</p>
      ) : (
        children
      )}
    </div>
  );
}

export default function TrackingTab() {
  const { sheets, loading, error, refetch } = useSheets();
  const { projects, refetch: refetchProjects, createProject, updateProject, deleteProject } =
    useProjects();
  const { prefs, update } = usePrefs();
  const toast = useToast();
  const view = prefs.views.tracking;

  const [filter, setFilter] = useState<string>("all"); // "all" | UNGROUPED | projectId
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ open: boolean; project: Project | null }>({
    open: false,
    project: null,
  });
  const [addTo, setAddTo] = useState<Project | null>(null);
  const [webhooksOpen, setWebhooksOpen] = useState(false);

  const [board, setBoard] = useState<Board>({});
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // Local, reorderable mirror of the server project order so a drag shifts
  // live and survives the drop (server order syncs back via the effect below).
  const [orderedProjects, setOrderedProjects] = useState<Project[]>([]);
  const dragSource = useRef<string | null>(null);

  const refetchAll = () => {
    refetch();
    refetchProjects();
  };

  const sheetById = useMemo(() => new Map(sheets.map((s) => [s.id, s])), [sheets]);
  const q = query.trim().toLowerCase();
  const searching = q !== "";

  // Server order is the source of truth; rebuild the board whenever it changes
  // and we're not mid-drag.
  // Rebuild the board only when the underlying data actually changes (a real
  // refetch). Deliberately NOT keyed on activeSheetId: clearing it at drop must
  // not re-run this and clobber the optimistic reorder with the stale (pre-save)
  // sheet order. The guard still skips rebuilds from refetches that land mid-drag.
  useEffect(() => {
    if (activeSheetId) return;
    setBoard(buildBoard(sheets, projects));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, projects]);

  // Same contract for the project order mirror: adopt server order on refetch,
  // but never clobber an in-progress project drag.
  useEffect(() => {
    if (activeProjectId) return;
    setOrderedProjects(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const countOf = (container: string) => (board[container] ?? []).length;

  const bulk = async (p: Project, action: "pause" | "resume" | "check") => {
    try {
      const { affected } = await api.post<{ affected: number }>(`/api/projects/${p.id}/bulk`, {
        action,
      });
      const verb = action === "pause" ? "paused" : action === "resume" ? "resumed" : "checking";
      toast.success(`${verb} ${affected} sheet${affected !== 1 ? "s" : ""} in “${p.name}”`);
      if (action === "check") setTimeout(refetchAll, 2500);
      else refetchAll();
    } catch {
      toast.error("Bulk action failed");
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Only the unfiltered, unsearched view allows dragging (projects + sheets
  // across groups). A single-group filter still reorders within that group.
  const dndEnabled = !searching;
  const draggableProjects = filter === "all" && dndEnabled;

  const containerFor = (over: { data?: { current?: { container?: string } }; id: string | number }) => {
    const c = over.data?.current?.container;
    if (c) return c;
    if (typeof over.id === "string" && over.id.startsWith("container:")) {
      return over.id.slice("container:".length);
    }
    return null;
  };

  const persistGroups = (next: Board, containers: string[]) => {
    api
      .post("/api/sheets/reorder", {
        groups: containers.map((c) => ({ projectId: projectIdOf(c), ids: next[c] ?? [] })),
      })
      .catch(() => {
        toast.error("Couldn’t save the new order");
        refetchAll();
      });
  };

  const onDragStart = (e: DragStartEvent) => {
    if (e.active.data.current?.type === "project") {
      setActiveProjectId(e.active.id as string);
      return;
    }
    if (e.active.data.current?.type !== "sheet") return;
    setActiveSheetId(e.active.id as string);
    dragSource.current = (e.active.data.current.container as string) ?? null;
  };

  // Live cross-container hop: move the id between board groups so it follows
  // the cursor into another project.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || active.data.current?.type !== "sheet") return;
    const from = active.data.current.container as string;
    const to = containerFor(over);
    if (!to || from === to) return;

    setBoard((prev) => {
      const fromIds = [...(prev[from] ?? [])];
      const toIds = [...(prev[to] ?? [])];
      const id = active.id as string;
      const idx = fromIds.indexOf(id);
      if (idx === -1) return prev;
      fromIds.splice(idx, 1);
      const overIsSheet = over.data.current?.type === "sheet";
      const insertAt = overIsSheet ? toIds.indexOf(over.id as string) : toIds.length;
      toIds.splice(insertAt < 0 ? toIds.length : insertAt, 0, id);
      return { ...prev, [from]: fromIds, [to]: toIds };
    });
    // The active item now lives in `to`; keep its data in sync for the next hop.
    active.data.current.container = to;
  };

  const onSheetDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const source = dragSource.current;
    setActiveSheetId(null);
    dragSource.current = null;
    if (!over) {
      setBoard(buildBoard(sheets, projects));
      return;
    }
    const container = (active.data.current?.container as string) ?? source;
    if (!container) return;

    setBoard((prev) => {
      const ids = [...(prev[container] ?? [])];
      const oldIndex = ids.indexOf(active.id as string);
      const overIsSheet = over.data.current?.type === "sheet";
      // Dropping on the container background (not a row) must keep the sheet
      // where it already sits — cross-container hops are placed live in
      // onDragOver, so falling back to the last index would wrongly jump the
      // item to the end.
      const newIndex = overIsSheet ? ids.indexOf(over.id as string) : oldIndex;
      const next = {
        ...prev,
        [container]:
          oldIndex === -1 || newIndex === -1 ? ids : arrayMove(ids, oldIndex, newIndex),
      };
      const affected = Array.from(new Set([source, container].filter(Boolean) as string[]));
      persistGroups(next, affected);
      return next;
    });
  };

  // Which project does a drop target belong to? closestCorners/closestCenter
  // often resolves `over` to a sheet row or a container droppable inside the
  // target project rather than the project section itself, so map those back.
  const projectIdForOver = (over: DragEndEvent["over"]): string | null => {
    if (!over) return null;
    const id = String(over.id);
    const has = (pid: string) => orderedProjects.some((p) => p.id === pid);
    if (has(id)) return id;
    const container = over.data?.current?.container as string | undefined;
    if (container && has(container)) return container;
    if (id.startsWith("container:")) {
      const c = id.slice("container:".length);
      return has(c) ? c : null;
    }
    const sheetProject = sheetById.get(id)?.projectId;
    return sheetProject && has(sheetProject) ? sheetProject : null;
  };

  const onProjectDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveProjectId(null);
    const overId = projectIdForOver(over);
    if (!overId || overId === active.id) return;
    const from = orderedProjects.findIndex((p) => p.id === active.id);
    const to = orderedProjects.findIndex((p) => p.id === overId);
    if (from === -1 || to === -1) return;
    const next = arrayMove(orderedProjects, from, to);
    setOrderedProjects(next); // optimistic: shift stays after drop
    api.post("/api/projects/reorder", { ids: next.map((p) => p.id) }).catch(() => {
      toast.error("Couldn’t reorder projects");
      refetchProjects();
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (e.active.data.current?.type === "project") onProjectDragEnd(e);
    else onSheetDragEnd(e);
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

  // Sheets of a container, in board order, optionally filtered by search.
  const sheetsOf = (container: string): Sheet[] =>
    (board[container] ?? [])
      .map((id) => sheetById.get(id))
      .filter((s): s is Sheet => !!s && (!q || s.label.toLowerCase().includes(q)));

  const renderGroupBody = (container: string) => {
    const list = sheetsOf(container);

    if (searching) {
      // No drag while searching — indices would be ambiguous with hidden rows.
      if (list.length === 0) {
        return <p className="pl-1 font-mono text-xs text-ink-300">no matches here</p>;
      }
      if (view === "list") {
        return (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {list.map((s) => (
              <SheetListRow key={s.id} sheet={s} projects={projects} onUpdated={refetchAll} />
            ))}
          </div>
        );
      }
      return (
        <div className="space-y-3">
          {list.map((s, i) => (
            <BlurFade key={s.id} delay={Math.min(i, 8) * 0.04}>
              <SheetRow sheet={s} projects={projects} onUpdated={refetchAll} />
            </BlurFade>
          ))}
        </div>
      );
    }

    return (
      <SortableContext items={board[container] ?? []} strategy={verticalListSortingStrategy}>
        <GroupList container={container} view={view} empty={list.length === 0}>
          {list.map((s) => (
            <SortableSheet
              key={s.id}
              sheet={s}
              container={container}
              view={view}
              projects={projects}
              onUpdated={refetchAll}
            />
          ))}
        </GroupList>
      </SortableContext>
    );
  };

  const projectHeader = (p: Project, dragHandle?: ReactNode) => {
    const anyActive = sheetsOf(p.id).some((s) => !s.paused);
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {dragHandle}
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
        <h2 className="font-display text-sm font-bold text-ink-900">{p.name}</h2>
        <span className="font-mono text-[11px] text-ink-400">{countOf(p.id)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            onClick={() => setAddTo(p)}
            className="rounded-md bg-teal-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-600 transition-colors hover:bg-teal hover:text-primary-foreground"
          >
            + add sheet
          </button>
          {countOf(p.id) > 0 && (
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
                title={anyActive ? "Pause all sheets in this project" : "Resume all sheets"}
              >
                {anyActive ? "❚❚ pause all" : "▶ resume all"}
              </button>
            </>
          )}
          <button
            onClick={() => setModal({ open: true, project: p })}
            aria-label={`Edit ${p.name}`}
            className="rounded-md px-2 py-0.5 font-mono text-[11px] text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
          >
            edit
          </button>
        </div>
      </div>
    );
  };

  const showProject = (p: Project) => {
    if (filter !== "all" && filter !== p.id) return null;
    if (!draggableProjects) {
      return (
        <section key={p.id} className="space-y-3">
          {projectHeader(p)}
          {renderGroupBody(p.id)}
        </section>
      );
    }
    return (
      <SortableProject key={p.id} id={p.id} header={(h) => projectHeader(p, h)}>
        {renderGroupBody(p.id)}
      </SortableProject>
    );
  };

  const showUngrouped =
    (filter === "all" || filter === UNGROUPED) && countOf(UNGROUPED) > 0 ? (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
          <h2 className="font-display text-sm font-bold text-ink-500">Ungrouped</h2>
          <span className="font-mono text-[11px] text-ink-400">{countOf(UNGROUPED)}</span>
        </div>
        {renderGroupBody(UNGROUPED)}
      </section>
    ) : null;

  const groups = (
    <div className="space-y-8">
      {draggableProjects ? (
        <SortableContext
          items={orderedProjects.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-8">{orderedProjects.map((p) => showProject(p))}</div>
        </SortableContext>
      ) : (
        orderedProjects.map((p) => showProject(p))
      )}
      {showUngrouped}
    </div>
  );

  return (
    <div className="animate-fade-up space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Tracking</h1>
          <p className="mt-1 text-sm text-ink-500">
            Watched on a schedule. Drag to reorder or move between projects.
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
            {projects.map((p) => chip(p.id, p.name, p.color, countOf(p.id)))}
            {countOf(UNGROUPED) > 0 && chip(UNGROUPED, "Ungrouped", undefined, countOf(UNGROUPED))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search tracked sheets"
              className="ml-auto w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-xs outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10"
            />
            <ViewToggle
              value={view}
              onChange={(v) => update({ views: { tracking: v } })}
              options={[
                { value: "cards", icon: LayoutGrid, label: "Cards" },
                { value: "list", icon: List, label: "List" },
              ]}
            />
          </div>

          {dndEnabled ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
            >
              {groups}
            </DndContext>
          ) : (
            groups
          )}
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

// Project group with a header drag handle (unfiltered view only).
function SortableProject({
  id,
  header,
  children,
}: {
  id: string;
  header: (handle: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "project" },
  });
  const handle = (
    <button
      aria-label="Drag project"
      className="cursor-grab text-ink-300 hover:text-ink-500 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`space-y-3 ${isDragging ? "z-10 opacity-80" : ""}`}
    >
      {header(handle)}
      {children}
    </section>
  );
}
