import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  applyAppearance,
  readStoredAppearance,
  resolveIsDark,
  writeStoredAppearance,
  type AppearancePrefs,
} from "@/lib/appearance";

interface ThemeContextValue {
  appearance: AppearancePrefs;
  isDark: boolean;
  setAppearance: (patch: Partial<AppearancePrefs>) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setState] = useState<AppearancePrefs>(readStoredAppearance);

  // Apply on mount and whenever settings change.
  useEffect(() => {
    applyAppearance(appearance);
    writeStoredAppearance(appearance);
  }, [appearance]);

  // Follow OS theme while in "system" mode.
  useEffect(() => {
    if (appearance.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance(appearance);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance]);

  const setAppearance = useCallback((patch: Partial<AppearancePrefs>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleTheme = useCallback(() => {
    setState((prev) => ({
      ...prev,
      theme: resolveIsDark(prev.theme) ? "light" : "dark",
    }));
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        appearance,
        isDark: resolveIsDark(appearance.theme),
        setAppearance,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
