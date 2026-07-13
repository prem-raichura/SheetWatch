export interface User {
  id: string;
  email: string;
  googleId: string;
  createdAt: string;
  digest?: "off" | "daily" | "weekly";
  digestHour?: number;
}

export type WebhookKind = "slack" | "discord" | "generic" | "telegram";

export interface Webhook {
  id: string;
  kind: WebhookKind;
  url: string;
  label: string;
  sheetCount?: number;
  createdAt: string;
}

export type AlertRuleOp = "eq" | "neq" | "gt" | "lt" | "contains" | "changes_to";

export interface AlertRule {
  column: string;
  op: AlertRuleOp;
  value: string;
}

export interface RuleCondition {
  column: string;
  op: AlertRuleOp;
  value: string;
}

// Conditions within a group are ANDed; groups are ORed. channels null = all
// enabled channels; entries: "push" | "email" | `webhook:${webhookId}`.
export interface RuleGroup {
  id: string;
  conditions: RuleCondition[];
  channels: string[] | null;
}

export interface AlertRulesV2 {
  version: 2;
  groups: RuleGroup[];
}

export interface NotificationLogEntry {
  id: string;
  sheetId: string | null;
  changeLogId: string | null;
  channel: "push" | "email" | "webhook" | "telegram";
  target: string;
  title: string;
  body: string;
  status: "sent" | "failed" | "queued" | "suppressed";
  error: string | null;
  attempts: number;
  deliverAfter: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface SnapshotMeta {
  id: string;
  hash: string;
  createdAt: string;
}

export interface KpiWidget {
  id: string;
  sheetId: string;
  sheetLabel?: string;
  cell: string;
  label: string;
  format: "number" | "currency" | "percent";
  sortOrder: number;
  alertAbove?: number | null;
  alertBelow?: number | null;
  value?: string | null;
  delta24h?: number | null;
  series?: (number | null)[];
}

export type WatchMode = "range" | "rowmatch";

export interface Project {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  notifyEmail: boolean;
  notifyPush: boolean;
  sheetCount?: number;
}

export interface Sheet {
  id: string;
  userId: string;
  projectId: string | null;
  project?: { id: string; name: string; color: string } | null;
  spreadsheetId: string;
  range: string;
  tab: string | null;
  watchMode: WatchMode;
  matchColumn: string | null;
  matchValue: string | null;
  label: string;
  pollInterval: number;
  lastCheckedAt: string | null;
  notifyEmail: boolean;
  notifyPush: boolean;
  paused: boolean;
  snoozedUntil: string | null;
  alertColumns: string[];
  alertRules?: AlertRule[] | AlertRulesV2 | null;
  webhookIds?: string[];
  errorMessage: string | null;
  createdAt: string;
}

export interface Overview {
  tracked: number;
  paused: number;
  active: number;
  errored: number;
  projects: number;
  changesToday: number;
  lastChangeAt: string | null;
  daily: { date: string; count: number }[];
}

export interface AvailableSheet {
  spreadsheetId: string;
  name: string;
  ownedByMe: boolean;
  modifiedTime: string;
  tracked: boolean;
  sheetId: string | null;
}

export interface CellChange {
  cell: string;
  before: string;
  after: string;
}

export interface ChangeLog {
  id: string;
  sheetId: string;
  summary: string;
  details: CellChange[];
  readAt?: string | null;
  createdAt: string;
}

export interface ChangeLogWithSheet extends ChangeLog {
  sheet: { label: string; spreadsheetId: string; archivedAt?: string | null };
}
