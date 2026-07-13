import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ChangeLog } from "../types";
import DiffGrid from "./DiffGrid";

interface ContextResponse {
  change: ChangeLog;
  range: string;
  startRow: number;
  rows: string[][];
}

interface Props {
  sheetId: string;
  changeId: string;
}

// Lazy-loaded grid view around a change — used by the expandable
// "view in grid" sections in history and activity.
export default function ChangeContext({ sheetId, changeId }: Props) {
  const [ctx, setCtx] = useState<ContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ContextResponse>(`/api/sheets/${sheetId}/changes/${changeId}/context`)
      .then(setCtx)
      .catch(() => setError("Couldn’t load the grid view."));
  }, [sheetId, changeId]);

  if (error) return <p className="px-4 py-3 font-mono text-xs text-coral-600">{error}</p>;
  if (!ctx) return <p className="px-4 py-3 font-mono text-xs text-ink-300">loading grid…</p>;
  if (ctx.rows.length === 0)
    return <p className="px-4 py-3 font-mono text-xs text-ink-300">no snapshot available</p>;

  return (
    <div className="px-4 py-3">
      <DiffGrid rows={ctx.rows} startRow={ctx.startRow} changes={ctx.change.details} range={ctx.range} />
      <p className="mt-2 font-mono text-[10px] text-ink-300">
        Highlighted cells show old → new. Grid reflects the current snapshot.
      </p>
    </div>
  );
}
