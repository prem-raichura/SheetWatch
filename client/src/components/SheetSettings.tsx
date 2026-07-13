import { useState, useEffect } from "react";
import { Sheet, Project, AlertRule, AlertRuleOp, AlertRulesV2, RuleCondition, RuleGroup } from "../types";
import { api } from "../lib/api";
import { useWebhooks } from "../hooks/useWebhooks";
import Spinner from "./Spinner";
import { DrawerShell } from "./Modal";
import RangePickerModal from "./RangePickerModal";

type UiMode = "whole" | "range" | "rows";

interface Props {
  sheet: Sheet;
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

const RULE_OPS: { value: AlertRuleOp; label: string }[] = [
  { value: "changes_to", label: "changes to" },
  { value: "eq", label: "equals" },
  { value: "neq", label: "≠ not equal" },
  { value: "gt", label: "> greater than" },
  { value: "lt", label: "< less than" },
  { value: "contains", label: "contains" },
];

const emptyCondition = (): RuleCondition => ({ column: "", op: "changes_to", value: "" });

function normalizeRules(raw: Sheet["alertRules"]): RuleGroup[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((r: AlertRule) => ({
      id: crypto.randomUUID(),
      conditions: [{ ...r }],
      channels: null,
    }));
  }
  return raw.groups;
}

const INTERVALS = [
  { label: "1 min", value: 60 },
  { label: "3 min", value: 180 },
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
];

function initialMode(sheet: Sheet): UiMode {
  if (sheet.watchMode === "rowmatch") return "rows";
  if (sheet.range && sheet.range !== "A1:Z1000") return "range";
  return "whole";
}

export default function SheetSettings({ sheet, projects, onClose, onSaved }: Props) {
  const [label, setLabel] = useState(sheet.label);
  const [projectId, setProjectId] = useState<string>(sheet.projectId ?? "");
  const [pollInterval, setPollInterval] = useState(sheet.pollInterval);
  const [mode, setMode] = useState<UiMode>(initialMode(sheet));
  const [tab, setTab] = useState<string>(sheet.tab ?? "");
  const [range, setRange] = useState(
    sheet.range && sheet.range !== "A1:Z1000" ? sheet.range : ""
  );
  const [matchColumn, setMatchColumn] = useState(sheet.matchColumn ?? "");
  const [matchValue, setMatchValue] = useState(sheet.matchValue ?? "");
  const [scanRange, setScanRange] = useState(
    sheet.watchMode === "rowmatch" ? sheet.range : "A1:Z1000"
  );

  const [alertColumns, setAlertColumns] = useState(sheet.alertColumns.join(", "));
  const { webhooks } = useWebhooks();
  const [webhookIds, setWebhookIds] = useState<string[]>(sheet.webhookIds ?? []);
  const [groups, setGroups] = useState<RuleGroup[]>(() => normalizeRules(sheet.alertRules));
  const [tabs, setTabs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    api
      .get<string[]>(`/api/sheets/${sheet.id}/tabs`)
      .then(setTabs)
      .catch(() => setTabs([]));
  }, [sheet.id]);

  const save = async () => {
    setSaving(true);
    setError(null);

    const cols = alertColumns
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (cols.some((c) => !/^[A-Z]{1,3}$/.test(c))) {
      setError("Alert columns must be letters like A, C, AA — comma separated.");
      setSaving(false);
      return;
    }

    const cleanGroups: RuleGroup[] = [];
    for (const g of groups) {
      const conditions = g.conditions
        .map((c) => ({ ...c, column: c.column.trim().toUpperCase(), value: c.value.trim() }))
        .filter((c) => c.column && c.value);
      for (const c of conditions) {
        if (!/^[A-Z]{1,3}$/.test(c.column)) {
          setError("Each condition needs a column letter like A, C, AA.");
          setSaving(false);
          return;
        }
        if ((c.op === "gt" || c.op === "lt") && (!/\d/.test(c.value) || Number.isNaN(Number(c.value.replace(/[^0-9eE.+-]/g, ""))))) {
          setError("Greater/less-than conditions need a numeric value.");
          setSaving(false);
          return;
        }
      }
      if (conditions.length > 0) cleanGroups.push({ ...g, conditions });
    }
    const alertRules: AlertRulesV2 | null =
      cleanGroups.length > 0 ? { version: 2, groups: cleanGroups } : null;

    let payload: Record<string, unknown> = {
      label,
      projectId: projectId || null,
      pollInterval,
      tab: tab || null,
      alertColumns: [...new Set(cols)],
      alertRules,
      webhookIds,
    };

    if (mode === "whole") {
      payload = { ...payload, watchMode: "range", range: "A1:Z1000", matchColumn: null, matchValue: null };
    } else if (mode === "range") {
      if (!range.trim()) {
        setError("Enter a range like B2:D50 or E11.");
        setSaving(false);
        return;
      }
      payload = { ...payload, watchMode: "range", range: range.trim().toUpperCase(), matchColumn: null, matchValue: null };
    } else {
      if (!matchColumn.trim() || !matchValue.trim()) {
        setError("Enter both a column and a value to match.");
        setSaving(false);
        return;
      }
      payload = {
        ...payload,
        watchMode: "rowmatch",
        range: (scanRange.trim() || "A1:Z1000").toUpperCase(),
        matchColumn: matchColumn.trim(),
        matchValue: matchValue.trim(),
      };
    }

    try {
      await api.patch(`/api/sheets/${sheet.id}`, payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save settings.");
      setSaving(false);
    }
  };

  const seg = (m: UiMode, text: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        mode === m ? "bg-foreground text-background shadow-xs" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {text}
    </button>
  );

  const field =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-hidden transition-shadow focus:border-teal focus:ring-4 focus:ring-teal/10";

  const attachedWebhooks = webhooks.filter((w) => webhookIds.includes(w.id));

  const updateGroup = (id: string, fn: (g: RuleGroup) => RuleGroup) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? fn(g) : g)));

  const toggleChannel = (id: string, key: string) =>
    updateGroup(id, (g) => {
      const cur = g.channels ?? [];
      const next = cur.includes(key) ? cur.filter((c) => c !== key) : [...cur, key];
      return { ...g, channels: next.length === 0 ? null : next };
    });

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
      active
        ? "border-teal/40 bg-teal-soft text-teal-600"
        : "border-line text-ink-400 hover:text-ink-700"
    }`;

  return (
    <DrawerShell onClose={onClose} maxWidth="max-w-md" label="Watch settings">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Watch settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md px-2 py-1 text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div>
            <label className="text-xs font-semibold text-ink-500">Name</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={`mt-1.5 ${field}`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-500">Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`mt-1.5 ${field}`}>
                <option value="">Ungrouped</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-500">Check every</label>
              <select
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
                className={`mt-1.5 ${field}`}
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500">Tab</label>
            <select value={tab} onChange={(e) => setTab(e.target.value)} className={`mt-1.5 ${field}`}>
              <option value="">First tab (default)</option>
              {tabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500">What to watch</label>
            <div className="mt-1.5 flex gap-1 rounded-xl border border-line bg-paper p-1">
              {seg("whole", "Whole tab")}
              {seg("range", "Range / cell")}
              {seg("rows", "Rows by value")}
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal-soft px-3 py-2 text-xs font-semibold text-teal-600 transition-colors hover:bg-teal hover:text-primary-foreground"
            >
              ▦ Open sheet &amp; select a region
            </button>

            {mode === "whole" && (
              <p className="mt-3 text-xs text-ink-400">
                Watches everything on the selected tab.
              </p>
            )}

            {mode === "range" && (
              <div className="mt-3">
                <input
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="B2:D50, E11, 5:5, or C:C"
                  className={`${field} font-mono`}
                />
                <p className="mt-1.5 font-mono text-[11px] text-ink-400">
                  A1 notation · a block, one cell, a row, or a column
                </p>
              </div>
            )}

            {mode === "rows" && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={matchColumn}
                    onChange={(e) => setMatchColumn(e.target.value)}
                    placeholder="Column (Status or C)"
                    className={`${field}`}
                  />
                  <input
                    value={matchValue}
                    onChange={(e) => setMatchValue(e.target.value)}
                    placeholder="Value (Pending)"
                    className={`${field}`}
                  />
                </div>
                <input
                  value={scanRange}
                  onChange={(e) => setScanRange(e.target.value)}
                  placeholder="Scan range (A1:Z1000)"
                  className={`${field} font-mono`}
                />
                <p className="text-xs text-ink-400">
                  Watches only rows where{" "}
                  <span className="font-semibold text-ink-700">{matchColumn || "column"}</span> equals{" "}
                  <span className="font-semibold text-ink-700">{matchValue || "value"}</span>. Include the
                  header row so names resolve.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500">Alert columns</label>
            <input
              value={alertColumns}
              onChange={(e) => setAlertColumns(e.target.value)}
              placeholder="A, C, F"
              className={`mt-1.5 ${field} font-mono`}
            />
            <p className="mt-1.5 text-xs text-ink-400">
              Only notify when these columns change. Leave empty to alert on any change —
              changes are always logged either way.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500">Alert rules</label>
            <div className="mt-1.5 space-y-2">
              {groups.map((g, gi) => (
                <div key={g.id} className="space-y-2">
                  {gi > 0 && (
                    <p className="text-center font-mono text-[11px] font-semibold text-ink-300">OR</p>
                  )}
                  <div className="rounded-xl border border-line bg-paper p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-ink-500">
                        Notify when ALL match
                      </span>
                      <button
                        type="button"
                        onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                        aria-label="Remove group"
                        className="rounded-md px-2 py-1 text-ink-300 transition-colors hover:bg-coral-soft hover:text-coral-600"
                      >
                        ✕
                      </button>
                    </div>
                    {g.conditions.map((c, ci) => (
                      <div key={ci} className="flex items-center gap-2">
                        <input
                          value={c.column}
                          onChange={(e) =>
                            updateGroup(g.id, (x) => ({
                              ...x,
                              conditions: x.conditions.map((y, j) =>
                                j === ci ? { ...y, column: e.target.value } : y
                              ),
                            }))
                          }
                          placeholder="Col"
                          aria-label="Condition column"
                          className={`${field} w-16 font-mono uppercase`}
                        />
                        <select
                          value={c.op}
                          onChange={(e) =>
                            updateGroup(g.id, (x) => ({
                              ...x,
                              conditions: x.conditions.map((y, j) =>
                                j === ci ? { ...y, op: e.target.value as AlertRuleOp } : y
                              ),
                            }))
                          }
                          aria-label="Condition operator"
                          className={`${field} w-36`}
                        >
                          {RULE_OPS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={c.value}
                          onChange={(e) =>
                            updateGroup(g.id, (x) => ({
                              ...x,
                              conditions: x.conditions.map((y, j) =>
                                j === ci ? { ...y, value: e.target.value } : y
                              ),
                            }))
                          }
                          placeholder="Value"
                          aria-label="Condition value"
                          className={`${field} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateGroup(g.id, (x) => ({
                              ...x,
                              conditions: x.conditions.filter((_, j) => j !== ci),
                            }))
                          }
                          aria-label="Remove condition"
                          className="rounded-md px-2 py-1 text-ink-300 transition-colors hover:bg-coral-soft hover:text-coral-600"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateGroup(g.id, (x) => ({ ...x, conditions: [...x.conditions, emptyCondition()] }))
                      }
                      className="rounded-md bg-paper px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-500 transition-colors hover:text-teal-600"
                    >
                      + condition
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-ink-400">send to</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateGroup(g.id, (x) => ({
                            ...x,
                            channels:
                              x.channels === null
                                ? ["push", "email", ...attachedWebhooks.map((w) => `webhook:${w.id}`)]
                                : null,
                          }))
                        }
                        className={chip(g.channels === null)}
                      >
                        All channels
                      </button>
                      {g.channels !== null &&
                        [
                          { key: "push", label: "Push" },
                          { key: "email", label: "Email" },
                          ...attachedWebhooks.map((w) => ({ key: `webhook:${w.id}`, label: w.label })),
                        ].map((ch) => (
                          <button
                            key={ch.key}
                            type="button"
                            onClick={() => toggleChannel(g.id, ch.key)}
                            className={chip((g.channels ?? []).includes(ch.key))}
                          >
                            {ch.label}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setGroups((gs) => [
                    ...gs,
                    { id: crypto.randomUUID(), conditions: [emptyCondition()], channels: null },
                  ])
                }
                className="rounded-md bg-paper px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-500 transition-colors hover:text-teal-600"
              >
                + OR group
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              Only notify when a group matches — every condition in the group must match, and any group
              can fire. &gt; / &lt; need numeric values. Changes are always logged.
            </p>
          </div>

          {webhooks.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-ink-500">Webhooks</label>
              <div className="mt-1.5 space-y-1.5">
                {webhooks.map((w) => (
                  <label
                    key={w.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-paper"
                  >
                    <input
                      type="checkbox"
                      checked={webhookIds.includes(w.id)}
                      onChange={(e) =>
                        setWebhookIds((ids) =>
                          e.target.checked ? [...ids, w.id] : ids.filter((id) => id !== w.id)
                        )
                      }
                      className="accent-teal"
                    />
                    <span className="font-medium">{w.label}</span>
                    <span className="font-mono text-[11px] uppercase text-ink-300">{w.kind}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-400">
                Change alerts for this sheet also go to the checked webhooks.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-coral/30 bg-coral-soft px-3 py-2 text-xs text-coral-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-4">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-teal-600 active:scale-[0.97] disabled:opacity-50"
          >
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save & re-baseline"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper"
          >
            Cancel
          </button>
        </div>

        {pickerOpen && (
          <RangePickerModal
            sheetId={sheet.id}
            tab={tab || null}
            onClose={() => setPickerOpen(false)}
            onPick={(picked) => {
              if (mode === "rows") {
                setScanRange(picked);
              } else {
                setMode("range");
                setRange(picked);
              }
              setPickerOpen(false);
            }}
          />
        )}
    </DrawerShell>
  );
}
