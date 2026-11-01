import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/context/ThemeContext";

const OPTIONS = [
  { key: "light", label: "Light", icon: "sun" },
  { key: "system", label: "System", icon: "monitor" },
  { key: "dark", label: "Dark", icon: "moon" },
];

/**
 * Light / System / Dark theme picker (mirrors mobile). Icon-only trigger in the
 * Header opens a small menu; the choice persists via ThemeContext.
 */
export default function ThemeToggle({ variant = "auto", testId = "theme-toggle" }) {
  const { theme, pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const onDark = variant === "on-dark";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const triggerName = pref === "system" ? "monitor" : theme === "dark" ? "moon" : "sun";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        aria-label="Theme"
        title="Theme"
        className={`p-2 rounded-full transition-colors ${
          onDark
            ? "hover:bg-white/10 text-white"
            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-[#1F3F5B] dark:text-slate-200"
        }`}
      >
        <Icon name={triggerName} tone="current" className="h-5 w-5" />
      </button>
      {open && (
        <div
          data-testid="theme-menu"
          className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-1.5 z-50"
        >
          {OPTIONS.map(({ key, label, icon }) => (
            <button
              key={key}
              data-testid={`theme-opt-${key}`}
              onClick={() => { setPref(key); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Icon name={icon} tone="current" className="h-4 w-4" />
              <span className="flex-1 text-left">{label}</span>
              {pref === key && <Icon name="check" tone="current" className="h-4 w-4 text-[#55B3AD]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
