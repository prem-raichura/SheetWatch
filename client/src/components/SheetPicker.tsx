import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import {
  columnToIndex,
  indexToColumn as colLetter,
  parseA1Selection,
  type GridCell,
  type SelectionMode,
} from "../lib/grid";
import { ModalShell } from "./Modal";
import { SkeletonRows } from "./Skeleton";

// The one visual grid picker. Every cell / range / column field in the app
// opens this; `select` decides what a pick means and what comes back.
//
// Coordinates are zero-based and absolute — a preview grid always starts at A1.
// The value handed to onPick is ALWAYS bare A1 with no tab prefix; the server
// prefixes the tab itself (buildRange in server/src/shared/google/sheets.ts).

export type PickerSource =
  | { kind: "tracked"; sheetId: string } // GET /api/sheets/:id/preview
  | { kind: "raw"; spreadsheetId: string }; // GET /api/compare/preview

interface BaseProps {
  source: PickerSource;
  tab: string | null;
  onClose: () => void;
  title?: string;
  hint?: string;
  /** A1 box picks must stay inside. Cells outside it are dimmed and inert. */
  restrict?: string;
  /** Column mode: return the header text when the first row has one. */
  preferHeaderText?: boolean;
}

export type SheetPickerProps =
  | (BaseProps & { select: "range"; initial?: string; onPick: (v: string) => void })
  | (BaseProps & { select: "boundedRange"; initial?: string; onPick: (v: string) => void })
  | (BaseProps & { select: "cell"; initial?: string; onPick: (v: string) => void })
  | (BaseProps & { select: "column"; initial?: string; onPick: (v: string) => void })
  | (BaseProps & { select: "columns"; initial?: string[]; onPick: (v: string[]) => void });

const COLS = 26; // both preview routes fetch A1:Z{rows}
const BASE_DEPTH = 60;
const MAX_DEPTH = 200; // server cap
const CACHE_TTL = 60_000;

// Opening a picker costs a Google API call behind a 30/min limiter, and the app
// now has ~10 picker buttons. Same sheet + tab + depth reuses the last grid.
const previewCache = new Map<string, { rows: string[][]; at: number }>();

function sourceKey(source: PickerSource, tab: string | null, depth: number) {
  const id = source.kind === "tracked" ? source.sheetId : source.spreadsheetId;
  return `${source.kind}:${id}:${tab ?? ""}:${depth}`;
}

async function loadPreview(
  source: PickerSource,
  tab: string | null,
  depth: number,
  force: boolean
): Promise<string[][]> {
  const key = sourceKey(source, tab, depth);
  const hit = previewCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.rows;

  const tabQuery = tab ? `&tab=${encodeURIComponent(tab)}` : "";
  const path =
    source.kind === "tracked"
      ? `/api/sheets/${source.sheetId}/preview?rows=${depth}${tabQuery}`
      : `/api/compare/preview?spreadsheetId=${encodeURIComponent(source.spreadsheetId)}&rows=${depth}${tabQuery}`;

  const data = await api.get<{ rows: string[][] }>(path);
  const rows = data.rows ?? [];
  previewCache.set(key, { rows, at: Date.now() });
  return rows;
}

const HEADINGS: Record<SheetPickerProps["select"], { title: string; hint: string; cta: string }> = {
  range: {
    title: "Select what to watch",
    hint: "Drag or Shift-click for one block, ⌘/Ctrl-click to start another — blocks don't have to touch.",
    cta: "Use this range",
  },
  boundedRange: {
    title: "Select a block of cells",
    hint: "Drag across cells, or click a column / row header. Hold Shift to extend the selection.",
    cta: "Use this range",
  },
  cell: { title: "Pick a cell", hint: "Click the cell you want to track.", cta: "Use this cell" },
  column: {
    title: "Pick a column",
    hint: "Click a column letter, or any cell in the column you want.",
    cta: "Use this column",
  },
  columns: {
    title: "Pick columns",
    hint: "Columns don't have to be side by side — add scattered ones with ⌘/Ctrl-click.",
    cta: "Use these columns",
  },
};

// Spelled out on screen, because the gestures differ per mode and nothing else
// tells you that a range field can only hold one block.
const GESTURES: Record<SheetPickerProps["select"], string[]> = {
  range: [
    "Drag across cells",
    "Shift-click to extend",
    "Click a row number or column letter",
    "⌘/Ctrl-click to add another block",
  ],
  boundedRange: ["Drag across cells", "Shift-click to extend", "Click a row number or column letter", "One block only"],
  cell: ["Click a cell"],
  column: ["Click a column letter", "…or any cell in it"],
  columns: ["Click a column", "Shift-click for a span", "⌘/Ctrl-click to add or drop one"],
};

// A finished block of the selection, in the same shape the rect math produces.
interface Block {
  mode: SelectionMode;
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
}

function blockToA1(b: Block): string {
  if (b.mode === "col") return `${colLetter(b.minC)}:${colLetter(b.maxC)}`;
  if (b.mode === "row") return `${b.minR + 1}:${b.maxR + 1}`;
  const a = `${colLetter(b.minC)}${b.minR + 1}`;
  const z = `${colLetter(b.maxC)}${b.maxR + 1}`;
  return a === z ? a : `${a}:${z}`;
}

export default function SheetPicker(props: SheetPickerProps) {
  const { source, tab, restrict, preferHeaderText } = props;
  const select = props.select;

  // What each mode is allowed to select.
  const rowsPickable = select === "range" || select === "boundedRange";
  const colsOnly = select === "column" || select === "columns";
  const singleCell = select === "cell";
  const multiColumns = select === "columns";
  // Only the watch range is stored as several blocks; a chart range and a KPI
  // cell each have to stay one box.
  const multiBlocks = select === "range";

  const [rows, setRows] = useState<string[][]>([]);
  const [depth, setDepth] = useState(BASE_DEPTH);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [anchor, setAnchor] = useState<GridCell | null>(null);
  const [focus, setFocus] = useState<GridCell | null>(null);
  const [mode, setMode] = useState<SelectionMode>("cell");
  const [dragging, setDragging] = useState(false);
  // Disjoint columns (⌘/Ctrl-click) — only meaningful in "columns" mode.
  const [extra, setExtra] = useState<Set<number>>(new Set());
  // Blocks already committed with ⌘/Ctrl; the live rect is the one being drawn.
  const [blocks, setBlocks] = useState<Block[]>([]);
  // Shown when ⌘/Ctrl-click is used somewhere it can't apply.
  const [note, setNote] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  const hasRows = useRef(false);

  const fetchRows = useCallback(
    (nextDepth: number, force: boolean) => {
      setError(null);
      if (hasRows.current) setRefreshing(true);
      else setLoading(true);
      loadPreview(source, tab, nextDepth, force)
        .then((r) => {
          hasRows.current = r.length > 0;
          setRows(r);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load sheet"))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    // Identity of the sheet, not the object literal the caller re-creates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.kind, source.kind === "tracked" ? source.sheetId : source.spreadsheetId, tab]
  );

  useEffect(() => {
    fetchRows(depth, false);
  }, [fetchRows, depth]);

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const rowCount = Math.max(rows.length, 20);

  // Box the selection must stay inside (KPI watch range, chart source range).
  const box = useMemo(() => {
    const sel = restrict ? parseA1Selection(restrict) : null;
    if (!sel) return null;
    // Whole-column and whole-row restrictions are only bounded on one axis.
    return {
      minR: sel.mode === "col" ? 0 : Math.min(sel.anchor.r, sel.focus.r),
      maxR: sel.mode === "col" ? Number.MAX_SAFE_INTEGER : Math.max(sel.anchor.r, sel.focus.r),
      minC: sel.mode === "row" ? 0 : Math.min(sel.anchor.c, sel.focus.c),
      maxC: sel.mode === "row" ? COLS - 1 : Math.max(sel.anchor.c, sel.focus.c),
    };
  }, [restrict]);

  const cellAllowed = useCallback(
    (r: number, c: number) =>
      !box || (r >= box.minR && r <= box.maxR && c >= box.minC && c <= box.maxC),
    [box]
  );
  const columnAllowed = useCallback(
    (c: number) => !box || (c >= box.minC && c <= box.maxC),
    [box]
  );

  // Seed from the value the field already holds, once the grid is in.
  const seeded = useRef(false);
  useEffect(() => {
    if (loading || seeded.current) return;
    seeded.current = true;

    if (props.select === "columns") {
      const cols = (props.initial ?? [])
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{1,3}$/.test(s))
        .map(columnToIndex)
        .filter((c) => c < COLS);
      if (cols.length === 0) return;
      setMode("col");
      setExtra(new Set(cols));
      return;
    }

    // A watch range can hold several blocks: seed all but the last as
    // committed, and leave the last one live so Shift keeps resizing it.
    const tokens = (props.initial ?? "").split(",").filter((t) => t.trim());
    const parsed = tokens
      .map((t) => parseA1Selection(t))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const fits = (s: NonNullable<ReturnType<typeof parseA1Selection>>) =>
      Math.max(s.anchor.c, s.focus.c) < COLS &&
      (s.mode === "col" || Math.max(s.anchor.r, s.focus.r) < rowCount);
    if (parsed.length !== tokens.length || !parsed.every(fits)) return;

    const asBlock = (s: NonNullable<ReturnType<typeof parseA1Selection>>): Block => ({
      mode: s.mode,
      minR: s.mode === "col" ? 0 : Math.min(s.anchor.r, s.focus.r),
      maxR: s.mode === "col" ? rowCount - 1 : Math.max(s.anchor.r, s.focus.r),
      minC: s.mode === "row" ? 0 : Math.min(s.anchor.c, s.focus.c),
      maxC: s.mode === "row" ? COLS - 1 : Math.max(s.anchor.c, s.focus.c),
    });

    if (multiBlocks && parsed.length > 1) setBlocks(parsed.slice(0, -1).map(asBlock));

    const sel = parsed[parsed.length - 1];
    if (!sel) return;
    if (sel.mode === "col" && !colsOnly && !rowsPickable) return;

    setMode(sel.mode);
    if (sel.mode === "col") {
      setAnchor({ r: 0, c: sel.anchor.c });
      setFocus({ r: rowCount - 1, c: sel.focus.c });
    } else if (sel.mode === "row") {
      setAnchor({ r: sel.anchor.r, c: 0 });
      setFocus({ r: sel.focus.r, c: COLS - 1 });
    } else {
      setAnchor(sel.anchor);
      setFocus(singleCell ? sel.anchor : sel.focus);
    }
  }, [loading, rowCount, props, colsOnly, rowsPickable, singleCell, multiBlocks]);

  // Keyboard works without clicking first.
  useEffect(() => {
    if (!loading && !error) gridRef.current?.focus();
  }, [loading, error]);

  const rect =
    anchor && focus
      ? {
          minR: Math.min(anchor.r, focus.r),
          maxR: Math.max(anchor.r, focus.r),
          minC: Math.min(anchor.c, focus.c),
          maxC: Math.max(anchor.c, focus.c),
        }
      : null;

  // Blocks committed with ⌘/Ctrl plus the one currently being drawn.
  const live: Block | null = rect ? { mode, ...rect } : null;
  const allBlocks: Block[] = live ? [...blocks, live] : blocks;

  const inAnyBlock = useCallback(
    (r: number, c: number) =>
      allBlocks.some((b) => r >= b.minR && r <= b.maxR && c >= b.minC && c <= b.maxC),
    [allBlocks]
  );

  // ---- selection handlers -------------------------------------------------

  // ⌘/Ctrl keeps what's already selected and starts a fresh block next to it.
  const startNewBlock = () => {
    if (live) setBlocks((prev) => [...prev, live]);
  };

  const selectColumn = (c: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (singleCell || !columnAllowed(c)) return;
    const withMeta = e.metaKey || e.ctrlKey;
    if (!withMeta) setNote(null);
    else if (select === "column") setNote("This field takes a single column.");
    else if (!multiColumns && !multiBlocks)
      setNote("This field takes one block — drag or Shift-click to size it.");

    // Watch range: ⌘/Ctrl keeps the current selection and adds a column block.
    if (multiBlocks && withMeta) {
      startNewBlock();
      setMode("col");
      setAnchor({ r: 0, c });
      setFocus({ r: rowCount - 1, c });
      setDragging(true);
      return;
    }

    // ⌘/Ctrl toggles one column without disturbing the rest, so "A, C, F" is
    // reachable. Any span already picked is folded in first — otherwise a
    // column inside the span couldn't be dropped again.
    if (multiColumns && (e.metaKey || e.ctrlKey)) {
      setExtra((prev) => {
        const next = new Set(prev);
        if (rect && mode === "col") for (let x = rect.minC; x <= rect.maxC; x++) next.add(x);
        if (next.has(c)) next.delete(c);
        else next.add(c);
        return next;
      });
      setMode("col");
      setAnchor(null);
      setFocus(null);
      return;
    }

    // "column" takes exactly one; Shift only extends inside column mode.
    if (e.shiftKey && mode === "col" && anchor && select !== "column") {
      setFocus({ r: rowCount - 1, c });
      return;
    }

    setMode("col");
    setAnchor({ r: 0, c });
    setFocus({ r: rowCount - 1, c });
    if (multiBlocks) setBlocks([]);
    if (multiColumns && !e.shiftKey) setExtra(new Set());
    if (!colsOnly || multiColumns) setDragging(true);
  };

  const selectRow = (r: number, e: { shiftKey: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (!rowsPickable) return;
    const withMeta = Boolean(e.metaKey || e.ctrlKey);
    if (withMeta && !multiBlocks) {
      setNote("Rows have to be one run — Shift-click a second row number for a span.");
    }
    if (box) return; // a restricted pick can't take a whole sheet row
    if (e.shiftKey && mode === "row" && anchor) {
      setFocus({ r, c: COLS - 1 });
      return;
    }
    if (multiBlocks && withMeta) startNewBlock();
    else if (multiBlocks) setBlocks([]);
    setMode("row");
    setAnchor({ r, c: 0 });
    setFocus({ r, c: COLS - 1 });
    setDragging(true);
  };

  const selectCell = (
    r: number,
    c: number,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  ) => {
    // In column modes a click on a value is a click on its column — that's the
    // column people are actually looking at.
    if (colsOnly) {
      selectColumn(c, e);
      return;
    }
    if (!cellAllowed(r, c)) return;

    const withMeta = e.metaKey || e.ctrlKey;
    if (!withMeta) setNote(null);
    else if (!multiBlocks) {
      // Nowhere to put a second block: this field holds one A1 range.
      setNote(
        singleCell
          ? "This field takes a single cell."
          : "This field takes one block — drag or Shift-click to size it."
      );
    }

    setMode("cell");
    if (singleCell) {
      setAnchor({ r, c });
      setFocus({ r, c });
      return;
    }

    // ⌘/Ctrl banks the block being drawn and starts another one here.
    if (multiBlocks && withMeta) startNewBlock();
    if (e.shiftKey && mode === "cell" && anchor && !withMeta) {
      setFocus({ r, c });
    } else {
      if (multiBlocks && !withMeta) setBlocks([]);
      setAnchor({ r, c });
      setFocus({ r, c });
    }
    setDragging(true);
  };

  // Drag-extend. Mode-aware, or dragging a cell past a header would flip modes.
  const extend = (r: number, c: number) => {
    if (!dragging || !anchor || singleCell) return;
    if (mode === "row") {
      if (rowsPickable) setFocus({ r, c: COLS - 1 });
    } else if (mode === "col") {
      if (columnAllowed(c) && select !== "column") setFocus({ r: rowCount - 1, c });
    } else if (cellAllowed(r, c)) {
      setFocus({ r, c });
    }
  };

  // Only the keyboard scrolls the grid. A row or column pick parks focus on the
  // far edge, and following it would yank the view away from the click.
  const keyNav = useRef(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    keyNav.current = true;

    const from = focus ?? anchor ?? { r: 0, c: 0 };
    const next = {
      r: Math.min(Math.max(from.r + d[0], 0), rowCount - 1),
      c: Math.min(Math.max(from.c + d[1], 0), COLS - 1),
    };

    if (mode === "col" && !singleCell) {
      if (!columnAllowed(next.c)) return;
      if (e.shiftKey && anchor && select !== "column") setFocus({ r: rowCount - 1, c: next.c });
      else {
        setAnchor({ r: 0, c: next.c });
        setFocus({ r: rowCount - 1, c: next.c });
      }
      return;
    }
    if (mode === "row") {
      if (e.shiftKey && anchor) setFocus({ r: next.r, c: COLS - 1 });
      else {
        setAnchor({ r: next.r, c: 0 });
        setFocus({ r: next.r, c: COLS - 1 });
      }
      return;
    }
    if (colsOnly) {
      selectColumn(next.c, { shiftKey: e.shiftKey, metaKey: false, ctrlKey: false });
      return;
    }
    if (!cellAllowed(next.r, next.c)) return;
    if (e.shiftKey && anchor && !singleCell) setFocus(next);
    else {
      setAnchor(next);
      setFocus(next);
    }
  };

  // Keep the moving edge of a keyboard selection on screen.
  useLayoutEffect(() => {
    if (!focus || !keyNav.current) return;
    keyNav.current = false;
    gridRef.current
      ?.querySelector(`[data-r="${focus.r}"][data-c="${focus.c}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);

  // ---- value --------------------------------------------------------------

  const selectedColumns = useMemo(() => {
    const set = new Set(extra);
    if (rect && mode === "col") for (let c = rect.minC; c <= rect.maxC; c++) set.add(c);
    return [...set].sort((a, b) => a - b).map(colLetter);
  }, [extra, rect, mode]);

  const value = useMemo(() => {
    // The watch range is stored as a comma-separated list of blocks.
    if (select === "range") return allBlocks.map(blockToA1).join(", ");

    if (!rect) return "";
    const { minR, maxR, minC, maxC } = rect;

    if (select === "cell") return `${colLetter(minC)}${minR + 1}`;

    if (select === "column") {
      const header = rows[0]?.[minC]?.trim();
      return preferHeaderText && header ? header : colLetter(minC);
    }

    if (select === "boundedRange") {
      // Never collapses to a single ref — parseA1Range on the server (and the
      // chart form) require both endpoints, so even 1×1 goes out as "B4:B4".
      if (mode === "col") return `${colLetter(minC)}1:${colLetter(maxC)}${rowCount}`;
      if (mode === "row") return `A${minR + 1}:${colLetter(COLS - 1)}${maxR + 1}`;
      return `${colLetter(minC)}${minR + 1}:${colLetter(maxC)}${maxR + 1}`;
    }

    if (mode === "col") return `${colLetter(minC)}:${colLetter(maxC)}`;
    if (mode === "row") return `${minR + 1}:${maxR + 1}`;
    const a = `${colLetter(minC)}${minR + 1}`;
    const b = `${colLetter(maxC)}${maxR + 1}`;
    return a === b ? a : `${a}:${b}`;
    // allBlocks changes with every rect change, which is what drives the
    // multi-block string above.
  }, [rect, mode, rows, rowCount, select, preferHeaderText, allBlocks]);

  const label = select === "columns" ? selectedColumns.join(", ") : value;
  const canCommit = select === "columns" ? selectedColumns.length > 0 : !!value;

  function commit() {
    // Narrowing off props.select keeps onPick's two shapes honest — don't
    // destructure onPick above or TS loses the correlation.
    if (props.select === "columns") {
      if (selectedColumns.length > 0) props.onPick(selectedColumns);
    } else if (value) {
      props.onPick(value);
    }
  }

  const heading = HEADINGS[select];
  const cellCount = rect && mode === "cell" ? (rect.maxR - rect.minR + 1) * (rect.maxC - rect.minC + 1) : 0;

  return (
    <ModalShell onClose={props.onClose} maxWidth="max-w-4xl" label={props.title ?? heading.title}>
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">
              {props.title ?? heading.title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-400">{props.hint ?? heading.hint}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {GESTURES[select].map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] text-ink-500"
                >
                  {g}
                </span>
              ))}
            </div>
            {box && (
              <p className="mt-1.5 font-mono text-[11px] text-ink-400">
                Limited to {restrict} — cells outside it are dimmed.
              </p>
            )}
          </div>
          <button
            onClick={props.onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-ink-400 hover:bg-paper hover:text-ink-900"
          >
            ✕
          </button>
        </div>

        <div
          ref={gridRef}
          tabIndex={0}
          role="grid"
          aria-label="Sheet preview"
          onKeyDown={onKeyDown}
          className="flex-1 overflow-auto p-4 outline-hidden focus-visible:ring-2 focus-visible:ring-teal/40"
        >
          {loading ? (
            <SkeletonRows count={5} />
          ) : error ? (
            <p className="text-sm text-coral-600">{error}</p>
          ) : (
            <table className="border-separate border-spacing-0 select-none font-mono text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-10 h-7 w-10 bg-paper" />
                  {Array.from({ length: COLS }).map((_, c) => {
                    const active =
                      allBlocks.some((b) => b.mode === "col" && c >= b.minC && c <= b.maxC) ||
                      extra.has(c);
                    const dim = !columnAllowed(c) || singleCell;
                    return (
                      <th
                        key={c}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectColumn(c, e);
                        }}
                        onMouseEnter={() => mode === "col" && extend(0, c)}
                        onContextMenu={(e) => e.preventDefault()}
                        className={`sticky top-0 h-7 min-w-[64px] border-b border-line px-2 font-semibold ${
                          dim ? "cursor-default bg-paper text-ink-300" : "cursor-pointer"
                        } ${
                          active
                            ? "bg-teal text-primary-foreground"
                            : dim
                              ? ""
                              : allBlocks.some(
                                    (b) => b.mode !== "row" && c >= b.minC && c <= b.maxC
                                  )
                                ? "bg-teal-soft text-teal-600"
                                : "bg-paper text-ink-500 hover:bg-teal-soft"
                        }`}
                      >
                        {colLetter(c)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }).map((_, r) => (
                  <tr key={r}>
                    <td
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectRow(r, e);
                      }}
                      onMouseEnter={() => mode === "row" && extend(r, 0)}
                      className={`sticky left-0 z-[1] h-7 w-10 border-r border-line px-1 text-center font-semibold ${
                        rowsPickable && !box ? "cursor-pointer" : "cursor-default text-ink-300"
                      } ${
                        allBlocks.some((b) => b.mode !== "col" && r >= b.minR && r <= b.maxR)
                          ? mode === "row"
                            ? "bg-teal text-primary-foreground"
                            : "bg-teal-soft text-teal-600"
                          : "bg-paper text-ink-400"
                      }`}
                    >
                      {r + 1}
                    </td>
                    {Array.from({ length: COLS }).map((_, c) => {
                      const val = rows[r]?.[c] ?? "";
                      const blocked = !cellAllowed(r, c);
                      const on =
                        mode === "col"
                          ? inAnyBlock(r, c) || extra.has(c)
                          : inAnyBlock(r, c);
                      const isFocus = focus?.r === r && focus?.c === c;
                      return (
                        <td
                          key={c}
                          data-r={r}
                          data-c={c}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectCell(r, c, e);
                          }}
                          onMouseEnter={() => extend(r, c)}
                          title={val}
                          className={`h-7 max-w-[140px] truncate border-b border-r border-line px-2 ${
                            blocked ? "cursor-not-allowed bg-paper text-ink-300" : "cursor-cell"
                          } ${
                            !blocked && on ? "bg-teal/15 text-ink-900" : blocked ? "" : "bg-card text-ink-700"
                          } ${isFocus ? "outline outline-1 outline-teal" : ""}`}
                          style={{ maxWidth: 140 }}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="flex items-center gap-3 font-mono text-[11px] text-ink-400">
            {depth < MAX_DEPTH && (
              <button
                type="button"
                onClick={() => setDepth(MAX_DEPTH)}
                disabled={refreshing}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-semibold text-ink-500 transition-colors hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
              >
                <ChevronDown className="h-3 w-3" /> Load more rows
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchRows(depth, true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-semibold text-ink-500 transition-colors hover:border-teal/40 hover:text-teal-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
            {note ? (
              <span className="text-coral-600">{note}</span>
            ) : (
              <span>
                showing {Math.min(rows.length, depth)} rows × A–Z — anything further can still be typed
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <div className="font-mono text-sm">
            {label ? (
              <span className="text-ink-700">
                Selected:{" "}
                <span className="rounded bg-teal-soft px-2 py-0.5 font-semibold text-teal-600">
                  {select === "range" || select === "boundedRange"
                    ? tab
                      ? `${tab}!${label}`
                      : label
                    : label}
                </span>
                {allBlocks.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setBlocks((prev) => prev.slice(0, -1))}
                    disabled={blocks.length === 0}
                    className="ml-2 rounded-md px-2 py-0.5 text-xs text-ink-400 transition-colors hover:bg-paper hover:text-coral-600 disabled:opacity-40"
                  >
                    {allBlocks.length} blocks · undo last
                  </button>
                ) : (
                  cellCount > 1 && (
                    <span className="ml-2 text-xs text-ink-400">
                      {rect!.maxR - rect!.minR + 1} × {rect!.maxC - rect!.minC + 1} · {cellCount} cells
                    </span>
                  )
                )}
              </span>
            ) : (
              <span className="text-ink-400">nothing selected yet</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={props.onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 hover:bg-paper"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={!canCommit}
              className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
            >
              {heading.cta}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
