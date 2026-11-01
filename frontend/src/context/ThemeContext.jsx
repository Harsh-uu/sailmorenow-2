import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext({ theme: "light", pref: "system", setPref: () => {}, toggle: () => {} });

const STORAGE_KEY = "smn-theme";

function systemScheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialPref() {
  if (typeof window === "undefined") return "system";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

/**
 * Theme provider with an explicit Light / Dark / System preference (mirrors
 * mobile). `pref` is persisted; the RESOLVED theme applies the `.dark` class
 * to <html>. When pref === "system" the app live-follows the OS scheme.
 */
export function ThemeProvider({ children }) {
  const [pref, setPrefState] = useState(initialPref);
  const [sysScheme, setSysScheme] = useState(systemScheme);

  const theme = pref === "system" ? sysScheme : pref;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    const meta = document.querySelector("meta[name='theme-color']");
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0B1220" : "#1F3F5B");
  }, [theme]);

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = (e) => setSysScheme(e.matches ? "dark" : "light");
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      pref,
      setPref: (p) => {
        window.localStorage.setItem(STORAGE_KEY, p);
        setPrefState(p);
      },
      // Back-compat: cycle light <-> dark for any legacy callers.
      toggle: () => {
        const next = theme === "dark" ? "light" : "dark";
        window.localStorage.setItem(STORAGE_KEY, next);
        setPrefState(next);
      },
    }),
    [theme, pref],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
