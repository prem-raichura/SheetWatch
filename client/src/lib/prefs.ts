import { DEFAULT_APPEARANCE, type AppearancePrefs } from "./appearance";

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM" 24h
  end: string;
}

export interface UserPrefs {
  version: 1;
  appearance: AppearancePrefs;
  dashboard: {
    sectionOrder: string[];
    hiddenSections: string[];
  };
  tables: {
    tracking: { columns: string[] };
    sheets: { columns: string[] };
  };
  notifications: {
    sound: "off" | "chime" | "pop";
    quietHours: QuietHours;
    timezone: string;
  };
  time: { hour12: boolean; relative: boolean };
  landingTab: "/overview" | "/sheets" | "/tracking" | "/activity";
  views: {
    tracking: "cards" | "list";
    sheets: "list" | "cards";
    activity: "timeline" | "table";
    kpis: "cards" | "strip";
  };
}

export const DASHBOARD_SECTIONS: { id: string; title: string }[] = [
  { id: "stats", title: "Stats" },
  { id: "kpis", title: "Pinned KPIs" },
  { id: "charts", title: "Charts" },
  { id: "activity-chart", title: "Last 7 days" },
  { id: "heatmap", title: "Change heatmap" },
  { id: "digest", title: "Email digest" },
  { id: "recent", title: "Recent changes" },
];

export const TRACKING_COLUMNS = [
  { id: "status", title: "Status" },
  { id: "label", title: "Name" },
  { id: "project", title: "Project" },
  { id: "interval", title: "Interval" },
  { id: "lastChecked", title: "Last checked" },
  { id: "alerts", title: "Alerts" },
  { id: "actions", title: "Actions" },
];

export const SHEETS_COLUMNS = [
  { id: "name", title: "Name" },
  { id: "owner", title: "Owner" },
  { id: "modified", title: "Modified" },
  { id: "tracked", title: "Tracked" },
  { id: "actions", title: "Actions" },
];

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  appearance: { ...DEFAULT_APPEARANCE },
  dashboard: {
    sectionOrder: DASHBOARD_SECTIONS.map((s) => s.id),
    hiddenSections: [],
  },
  tables: {
    tracking: { columns: TRACKING_COLUMNS.map((c) => c.id) },
    sheets: { columns: SHEETS_COLUMNS.map((c) => c.id) },
  },
  notifications: {
    sound: "off",
    quietHours: { enabled: false, start: "22:00", end: "07:00" },
    timezone: "",
  },
  time: { hour12: true, relative: true },
  landingTab: "/overview",
  views: {
    tracking: "cards",
    sheets: "list",
    activity: "timeline",
    kpis: "cards",
  },
};

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Deep-merge a partial (or unknown-shaped) value over defaults. Arrays and
// scalars replace wholesale; unknown keys are dropped.
export function mergePrefs<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) return defaults;
  const out: Plain = { ...(defaults as Plain) };
  for (const key of Object.keys(defaults as Plain)) {
    const d = (defaults as Plain)[key];
    const s = (stored as Plain)[key];
    if (s === undefined) continue;
    if (isPlainObject(d)) {
      out[key] = mergePrefs(d, s);
    } else if (Array.isArray(d)) {
      out[key] = Array.isArray(s) ? s : d;
    } else if (typeof s === typeof d) {
      out[key] = s;
    }
  }
  return out as T;
}

// Deep-partial of UserPrefs for PATCHes.
export type PrefsPatch = {
  [K in keyof UserPrefs]?: UserPrefs[K] extends object
    ? Partial<UserPrefs[K]> | UserPrefs[K]
    : UserPrefs[K];
};
