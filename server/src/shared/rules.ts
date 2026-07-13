import { randomUUID } from "crypto";
import { CellChange } from "./types";
import { indexToColumn, rangeStartColumn } from "./google/sheets";

export const RULE_OPS = ["eq", "neq", "gt", "lt", "contains", "changes_to"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

// v1 shape — flat array, OR semantics, all channels. Still accepted on write
// and normalized at read; rows in the DB are never migrated.
export interface AlertRule {
  column: string; // A1 column letters, e.g. "C"
  op: RuleOp;
  value: string;
}

export interface RuleCondition {
  column: string;
  op: RuleOp;
  value: string;
}

// Channels a group routes to. null = every channel the sheet has enabled.
// Entries: "push" | "email" | `webhook:${webhookId}`.
export interface RuleGroup {
  id: string;
  conditions: RuleCondition[]; // ANDed; min 1
  channels: string[] | null;
}

export interface AlertRulesV2 {
  version: 2;
  groups: RuleGroup[]; // ORed
}

// Tolerant numeric parse: strips currency symbols, commas, percent signs.
export function parseNumeric(raw: string): number {
  return Number(raw.replace(/[^0-9eE.+-]/g, ""));
}

function validCondition(c: unknown): string | null {
  if (typeof c !== "object" || c === null) return "each condition must be an object";
  const { column, op, value } = c as Record<string, unknown>;
  if (typeof column !== "string" || !/^[A-Za-z]{1,3}$/.test(column.trim())) {
    return "condition column must be letters like A, C, AA";
  }
  if (typeof op !== "string" || !RULE_OPS.includes(op as RuleOp)) {
    return `condition op must be one of: ${RULE_OPS.join(", ")}`;
  }
  if (typeof value !== "string" || value.trim() === "") return "condition value required";
  if ((op === "gt" || op === "lt") && (!/\d/.test(value) || Number.isNaN(parseNumeric(value)))) {
    return "gt/lt conditions need a numeric value";
  }
  return null;
}

// Accepts a v1 array or a v2 object; returns an error string or null.
// `ownedWebhookIds` guards channel references against foreign webhooks.
export function validateRules(input: unknown, ownedWebhookIds?: Set<string>): string | null {
  if (Array.isArray(input)) {
    for (const rule of input) {
      const err = validCondition(rule);
      if (err) return err;
    }
    return null;
  }
  if (typeof input === "object" && input !== null) {
    const v2 = input as Partial<AlertRulesV2>;
    if (v2.version !== 2 || !Array.isArray(v2.groups)) {
      return "alertRules must be a v1 array or {version:2, groups:[…]}";
    }
    for (const group of v2.groups) {
      if (typeof group !== "object" || group === null) return "each group must be an object";
      if (!Array.isArray(group.conditions) || group.conditions.length === 0) {
        return "each group needs at least one condition";
      }
      for (const c of group.conditions) {
        const err = validCondition(c);
        if (err) return err;
      }
      if (group.channels !== null && group.channels !== undefined) {
        if (!Array.isArray(group.channels)) return "group channels must be null or an array";
        for (const ch of group.channels) {
          if (typeof ch !== "string") return "channel entries must be strings";
          if (ch !== "push" && ch !== "email" && !ch.startsWith("webhook:")) {
            return `unknown channel "${ch}"`;
          }
          if (ch.startsWith("webhook:") && ownedWebhookIds && !ownedWebhookIds.has(ch.slice(8))) {
            return "channel references a webhook you don't own";
          }
        }
      }
    }
    return null;
  }
  return "alertRules must be a v1 array or {version:2, groups:[…]}";
}

function normalizeCondition(c: RuleCondition): RuleCondition {
  return { column: c.column.trim().toUpperCase(), op: c.op, value: c.value.trim() };
}

// Read path for anything stored in Sheet.alertRules. v1 arrays become
// one-condition groups with all-channel delivery — exactly v1 semantics.
export function normalizeToV2(raw: unknown): AlertRulesV2 | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return {
      version: 2,
      groups: (raw as AlertRule[]).map((r) => ({
        id: randomUUID(),
        conditions: [normalizeCondition(r)],
        channels: null,
      })),
    };
  }
  const v2 = raw as AlertRulesV2;
  if (v2.version === 2 && Array.isArray(v2.groups)) {
    if (v2.groups.length === 0) return null;
    return {
      version: 2,
      groups: v2.groups.map((g) => ({
        id: typeof g.id === "string" && g.id ? g.id : randomUUID(),
        conditions: g.conditions.map(normalizeCondition),
        channels: g.channels === null || g.channels === undefined ? null : [...g.channels],
      })),
    };
  }
  return null;
}

function evalCondition(cond: RuleCondition, change: CellChange): boolean {
  const after = change.after.trim();
  const before = change.before.trim();
  switch (cond.op) {
    case "eq":
      return after.toLowerCase() === cond.value.toLowerCase();
    case "neq":
      return after.toLowerCase() !== cond.value.toLowerCase();
    case "gt": {
      const n = parseNumeric(after);
      return !Number.isNaN(n) && n > parseNumeric(cond.value);
    }
    case "lt": {
      const n = parseNumeric(after);
      return !Number.isNaN(n) && n < parseNumeric(cond.value);
    }
    case "contains":
      return after.toLowerCase().includes(cond.value.toLowerCase());
    case "changes_to":
      return (
        after.toLowerCase() === cond.value.toLowerCase() &&
        before.toLowerCase() !== cond.value.toLowerCase()
      );
    default:
      return false;
  }
}

export interface RuleMatch {
  matched: boolean;
  // "all" when any matched group routes everywhere; otherwise the union of
  // matched groups' channel lists.
  channels: Set<string> | "all";
}

// Groups are ORed; conditions within a group are ANDed. Conditions on
// different columns may be satisfied by different cells of the same change
// event. Cell refs ("R3C2") are relative to the fetched grid, so offset by
// the range's start column — same convention as changedColumns() in poll.ts.
export function matchRulesV2(
  changes: CellChange[],
  rules: AlertRulesV2 | null,
  range: string
): RuleMatch {
  if (!rules || rules.groups.length === 0) return { matched: true, channels: "all" };

  const offset = rangeStartColumn(range);
  const byColumn = new Map<string, CellChange[]>();
  for (const change of changes) {
    const m = /^R\d+C(\d+)$/.exec(change.cell);
    if (!m) continue;
    const column = indexToColumn(offset + Number(m[1]) - 1);
    const list = byColumn.get(column);
    if (list) list.push(change);
    else byColumn.set(column, [change]);
  }

  let matched = false;
  let all = false;
  const channels = new Set<string>();

  for (const group of rules.groups) {
    const groupHit = group.conditions.every((cond) =>
      (byColumn.get(cond.column) ?? []).some((change) => evalCondition(cond, change))
    );
    if (!groupHit) continue;
    matched = true;
    if (group.channels === null) all = true;
    else for (const ch of group.channels) channels.add(ch);
  }

  if (!matched) return { matched: false, channels: new Set() };
  return { matched: true, channels: all ? "all" : channels };
}

// ————— v1 compatibility (kept for existing callers/tests) —————

export function normalizeRules(input: AlertRule[]): AlertRule[] {
  return input.map((r) => ({
    column: r.column.trim().toUpperCase(),
    op: r.op,
    value: r.value.trim(),
  }));
}

export function matchesRules(changes: CellChange[], rules: AlertRule[], range: string): boolean {
  if (rules.length === 0) return true;
  return matchRulesV2(changes, normalizeToV2(rules), range).matched;
}
