// User preferences: schema, defaults, and validation. Stored as JSON on
// User.prefs — mergePrefs normalises whatever is in the DB (null, partial,
// stale keys) into a full UserPrefs; applyPrefsPatch validates a deep-partial
// client patch before it is persisted.

export interface UserPrefs {
  version: 1;
  appearance: {
    theme: "light" | "dark" | "system";
    accent: string; // hex #RRGGBB
    density: "comfortable" | "compact";
    fontScale: "sm" | "md" | "lg";
    animation: "full" | "reduced" | "off";
  };
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
    quietHours: { enabled: boolean; start: string; end: string }; // HH:MM 24h
    timezone: string; // IANA or ""
  };
  time: { hour12: boolean; relative: boolean };
  landingTab: "/overview" | "/sheets" | "/tracking" | "/activity";
}

export const SECTION_IDS = [
  "stats",
  "kpis",
  "charts",
  "activity-chart",
  "heatmap",
  "digest",
  "recent",
] as const;

export const TRACKING_COLUMNS = [
  "status",
  "label",
  "project",
  "interval",
  "lastChecked",
  "alerts",
  "actions",
] as const;

export const SHEETS_COLUMNS = ["name", "owner", "modified", "tracked", "actions"] as const;

const THEMES = ["light", "dark", "system"] as const;
const DENSITIES = ["comfortable", "compact"] as const;
const FONT_SCALES = ["sm", "md", "lg"] as const;
const ANIMATIONS = ["full", "reduced", "off"] as const;
const SOUNDS = ["off", "chime", "pop"] as const;
const LANDING_TABS = ["/overview", "/sheets", "/tracking", "/activity"] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_PREFS: UserPrefs = {
  version: 1,
  appearance: {
    theme: "system",
    accent: "#0FA3A3",
    density: "comfortable",
    fontScale: "md",
    animation: "full",
  },
  dashboard: {
    sectionOrder: [...SECTION_IDS],
    hiddenSections: [],
  },
  tables: {
    tracking: { columns: [...TRACKING_COLUMNS] },
    sheets: { columns: [...SHEETS_COLUMNS] },
  },
  notifications: {
    sound: "off",
    quietHours: { enabled: false, start: "22:00", end: "07:00" },
    timezone: "",
  },
  time: { hour12: true, relative: true },
  landingTab: "/overview",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

// "" is allowed (client hasn't picked one); anything else must be a real
// IANA zone name the runtime knows about.
function isValidTimezone(tz: string): boolean {
  if (tz === "") return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return isOneOf(v, allowed) ? v : fallback;
}

// Lenient array pick for stored data: non-array falls back wholesale,
// entries not in the known id set are silently dropped (stale ids from
// older app versions).
function pickIds(v: unknown, allowed: readonly string[], fallback: readonly string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  return v.filter((x): x is string => typeof x === "string" && allowed.includes(x));
}

// Normalise whatever is stored on User.prefs (null, partial, garbage,
// unknown keys) into a complete UserPrefs. Wrong-typed values fall back to
// the default; unknown keys are dropped by construction.
export function mergePrefs(stored: unknown): UserPrefs {
  const s = isRecord(stored) ? stored : {};
  const ap = isRecord(s.appearance) ? s.appearance : {};
  const db = isRecord(s.dashboard) ? s.dashboard : {};
  const tables = isRecord(s.tables) ? s.tables : {};
  const tracking = isRecord(tables.tracking) ? tables.tracking : {};
  const sheets = isRecord(tables.sheets) ? tables.sheets : {};
  const nt = isRecord(s.notifications) ? s.notifications : {};
  const qh = isRecord(nt.quietHours) ? nt.quietHours : {};
  const tm = isRecord(s.time) ? s.time : {};
  const d = DEFAULT_PREFS;

  return {
    version: 1,
    appearance: {
      theme: pickEnum(ap.theme, THEMES, d.appearance.theme),
      accent:
        typeof ap.accent === "string" && HEX_RE.test(ap.accent) ? ap.accent : d.appearance.accent,
      density: pickEnum(ap.density, DENSITIES, d.appearance.density),
      fontScale: pickEnum(ap.fontScale, FONT_SCALES, d.appearance.fontScale),
      animation: pickEnum(ap.animation, ANIMATIONS, d.appearance.animation),
    },
    dashboard: {
      sectionOrder: pickIds(db.sectionOrder, SECTION_IDS, d.dashboard.sectionOrder),
      hiddenSections: pickIds(db.hiddenSections, SECTION_IDS, d.dashboard.hiddenSections),
    },
    tables: {
      tracking: { columns: pickIds(tracking.columns, TRACKING_COLUMNS, d.tables.tracking.columns) },
      sheets: { columns: pickIds(sheets.columns, SHEETS_COLUMNS, d.tables.sheets.columns) },
    },
    notifications: {
      sound: pickEnum(nt.sound, SOUNDS, d.notifications.sound),
      quietHours: {
        enabled:
          typeof qh.enabled === "boolean" ? qh.enabled : d.notifications.quietHours.enabled,
        start:
          typeof qh.start === "string" && HHMM_RE.test(qh.start)
            ? qh.start
            : d.notifications.quietHours.start,
        end:
          typeof qh.end === "string" && HHMM_RE.test(qh.end)
            ? qh.end
            : d.notifications.quietHours.end,
      },
      timezone:
        typeof nt.timezone === "string" && isValidTimezone(nt.timezone)
          ? nt.timezone
          : d.notifications.timezone,
    },
    time: {
      hour12: typeof tm.hour12 === "boolean" ? tm.hour12 : d.time.hour12,
      relative: typeof tm.relative === "boolean" ? tm.relative : d.time.relative,
    },
    landingTab: pickEnum(s.landingTab, LANDING_TABS, d.landingTab),
  };
}

function enumError(path: string, allowed: readonly string[]): string {
  return `${path} must be one of ${allowed.join(", ")}`;
}

// Strict array check for patches: every entry must be a known id.
function idArrayError(path: string, v: unknown, allowed: readonly string[]): string | null {
  if (!Array.isArray(v)) return `${path} must be an array`;
  for (const x of v) {
    if (typeof x !== "string" || !allowed.includes(x)) {
      return `${path} contains unknown id ${JSON.stringify(x)}`;
    }
  }
  return null;
}

// Validate a deep-partial patch and merge it into `current`. Rejects the
// whole patch (error string, prefs unchanged) on the first invalid field.
// An empty-string timezone is a valid value and is stored as sent — the
// client fills in its own zone.
export function applyPrefsPatch(
  current: UserPrefs,
  patch: unknown
): { prefs: UserPrefs; error: string | null } {
  const fail = (error: string) => ({ prefs: current, error });
  if (!isRecord(patch)) return fail("patch must be an object");

  const next: UserPrefs = {
    ...current,
    appearance: { ...current.appearance },
    dashboard: {
      sectionOrder: [...current.dashboard.sectionOrder],
      hiddenSections: [...current.dashboard.hiddenSections],
    },
    tables: {
      tracking: { columns: [...current.tables.tracking.columns] },
      sheets: { columns: [...current.tables.sheets.columns] },
    },
    notifications: {
      ...current.notifications,
      quietHours: { ...current.notifications.quietHours },
    },
    time: { ...current.time },
  };

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "version":
        if (value !== 1) return fail("version must be 1");
        break;

      case "appearance": {
        if (!isRecord(value)) return fail("appearance must be an object");
        for (const [k, v] of Object.entries(value)) {
          switch (k) {
            case "theme":
              if (!isOneOf(v, THEMES)) return fail(enumError("appearance.theme", THEMES));
              next.appearance.theme = v;
              break;
            case "accent":
              if (typeof v !== "string" || !HEX_RE.test(v)) {
                return fail("appearance.accent must be a hex color like #0FA3A3");
              }
              next.appearance.accent = v;
              break;
            case "density":
              if (!isOneOf(v, DENSITIES)) return fail(enumError("appearance.density", DENSITIES));
              next.appearance.density = v;
              break;
            case "fontScale":
              if (!isOneOf(v, FONT_SCALES)) {
                return fail(enumError("appearance.fontScale", FONT_SCALES));
              }
              next.appearance.fontScale = v;
              break;
            case "animation":
              if (!isOneOf(v, ANIMATIONS)) {
                return fail(enumError("appearance.animation", ANIMATIONS));
              }
              next.appearance.animation = v;
              break;
            default:
              return fail(`unknown pref key "appearance.${k}"`);
          }
        }
        break;
      }

      case "dashboard": {
        if (!isRecord(value)) return fail("dashboard must be an object");
        for (const [k, v] of Object.entries(value)) {
          switch (k) {
            case "sectionOrder": {
              const err = idArrayError("dashboard.sectionOrder", v, SECTION_IDS);
              if (err) return fail(err);
              next.dashboard.sectionOrder = [...(v as string[])];
              break;
            }
            case "hiddenSections": {
              const err = idArrayError("dashboard.hiddenSections", v, SECTION_IDS);
              if (err) return fail(err);
              next.dashboard.hiddenSections = [...(v as string[])];
              break;
            }
            default:
              return fail(`unknown pref key "dashboard.${k}"`);
          }
        }
        break;
      }

      case "tables": {
        if (!isRecord(value)) return fail("tables must be an object");
        for (const [k, v] of Object.entries(value)) {
          if (k !== "tracking" && k !== "sheets") {
            return fail(`unknown pref key "tables.${k}"`);
          }
          if (!isRecord(v)) return fail(`tables.${k} must be an object`);
          const allowed = k === "tracking" ? TRACKING_COLUMNS : SHEETS_COLUMNS;
          for (const [ck, cv] of Object.entries(v)) {
            if (ck !== "columns") return fail(`unknown pref key "tables.${k}.${ck}"`);
            const err = idArrayError(`tables.${k}.columns`, cv, allowed);
            if (err) return fail(err);
            next.tables[k].columns = [...(cv as string[])];
          }
        }
        break;
      }

      case "notifications": {
        if (!isRecord(value)) return fail("notifications must be an object");
        for (const [k, v] of Object.entries(value)) {
          switch (k) {
            case "sound":
              if (!isOneOf(v, SOUNDS)) return fail(enumError("notifications.sound", SOUNDS));
              next.notifications.sound = v;
              break;
            case "quietHours": {
              if (!isRecord(v)) return fail("notifications.quietHours must be an object");
              for (const [qk, qv] of Object.entries(v)) {
                switch (qk) {
                  case "enabled":
                    if (typeof qv !== "boolean") {
                      return fail("notifications.quietHours.enabled must be a boolean");
                    }
                    next.notifications.quietHours.enabled = qv;
                    break;
                  case "start":
                  case "end":
                    if (typeof qv !== "string" || !HHMM_RE.test(qv)) {
                      return fail(`notifications.quietHours.${qk} must be HH:MM (24h)`);
                    }
                    next.notifications.quietHours[qk] = qv;
                    break;
                  default:
                    return fail(`unknown pref key "notifications.quietHours.${qk}"`);
                }
              }
              break;
            }
            case "timezone":
              if (typeof v !== "string" || !isValidTimezone(v)) {
                return fail('notifications.timezone must be "" or a valid IANA timezone');
              }
              next.notifications.timezone = v;
              break;
            default:
              return fail(`unknown pref key "notifications.${k}"`);
          }
        }
        break;
      }

      case "time": {
        if (!isRecord(value)) return fail("time must be an object");
        for (const [k, v] of Object.entries(value)) {
          if (k !== "hour12" && k !== "relative") {
            return fail(`unknown pref key "time.${k}"`);
          }
          if (typeof v !== "boolean") return fail(`time.${k} must be a boolean`);
          next.time[k] = v;
        }
        break;
      }

      case "landingTab":
        if (!isOneOf(value, LANDING_TABS)) return fail(enumError("landingTab", LANDING_TABS));
        next.landingTab = value;
        break;

      default:
        return fail(`unknown pref key "${key}"`);
    }
  }

  return { prefs: next, error: null };
}
