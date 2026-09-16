import { useEffect, useState, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";

export type ThemeMode = "dark" | "light";

const THEME_KEY = "theme";

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  // shadcn: light = :root (no class), dark = .dark
  if (theme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
}

/**
 * Theme hook — dark (default) or light. Persists to settings.json so
 * the choice survives across sessions. On first load, falls back to the
 * OS preference if no saved value is found.
 */
export function useTheme(): {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  // Load theme on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const store = await Store.load("settings.json");
        const stored = await store.get<ThemeMode>(THEME_KEY);
        if (cancelled) return;
        if (stored === "dark" || stored === "light") {
          setThemeState(stored);
          applyTheme(stored);
        } else {
          // First run: respect OS preference
          const prefersLight =
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: light)").matches;
          const initial: ThemeMode = prefersLight ? "light" : "dark";
          setThemeState(initial);
          applyTheme(initial);
        }
      } catch (err) {
        console.error("Failed to load theme:", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyTheme(next);
    void (async () => {
      try {
        const store = await Store.load("settings.json");
        await store.set(THEME_KEY, next);
        await store.save();
      } catch (err) {
        console.error("Failed to save theme:", err);
      }
    })();
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
