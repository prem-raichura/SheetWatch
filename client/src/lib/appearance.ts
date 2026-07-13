export type ThemeSetting = "light" | "dark" | "system";

export interface AppearancePrefs {
  theme: ThemeSetting;
  accent: string; // hex, e.g. "#0FA3A3"
  density: "comfortable" | "compact";
  fontScale: "sm" | "md" | "lg";
  animation: "full" | "reduced" | "off";
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: "system",
  accent: "#0FA3A3",
  density: "comfortable",
  fontScale: "md",
  animation: "full",
};

export const PREFS_STORAGE_KEY = "sw:prefs";

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveIsDark(theme: ThemeSetting): boolean {
  return theme === "dark" || (theme === "system" && systemPrefersDark());
}

// Applies appearance to the document. The inline boot script in index.html
// does the same minimal work pre-React to avoid a flash of the wrong theme.
export function applyAppearance(a: AppearancePrefs): void {
  const html = document.documentElement;
  const dark = resolveIsDark(a.theme);
  html.classList.toggle("dark", dark);
  html.style.setProperty("--accent-base", a.accent);
  html.dataset.density = a.density;
  html.dataset.fontscale = a.fontScale;
  html.dataset.anim = a.animation;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#14181f" : "#F6F7F9";
}

export function readStoredAppearance(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw)?.appearance ?? {};
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeStoredAppearance(a: AppearancePrefs): void {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.appearance = a;
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // storage unavailable (private mode) — theme still applies for the session
  }
}
