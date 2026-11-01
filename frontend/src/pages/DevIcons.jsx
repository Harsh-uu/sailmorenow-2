import { useState } from "react";
import { ICONS, Icon } from "@/components/Icon";

const TONES = ["default", "muted", "accent", "brand", "onAccent", "disabled", "current"];
const SIZES = [16, 20, 24, 32, 40];
const ALL = Object.keys(ICONS);

/**
 * Hidden developer gallery (dev-only, see App.js). Pick a size, then click any
 * tone swatch (or the icon name) to copy a tone/size-specific
 * <Icon name="…" tone="…" size={…} /> snippet. Route: /dev/icons
 */
export default function DevIcons() {
  const [q, setQ] = useState("");
  const [size, setSize] = useState(24);
  const [copied, setCopied] = useState("");
  const names = ALL.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));

  const snippetFor = (n, tone) => {
    const parts = [`name="${n}"`];
    if (tone && tone !== "default") parts.push(`tone="${tone}"`);
    if (size !== 24) parts.push(`size={${size}}`);
    return `<Icon ${parts.join(" ")} />`;
  };

  const copy = async (n, tone) => {
    const key = `${n}|${tone}`;
    try {
      await navigator.clipboard.writeText(snippetFor(n, tone));
    } catch {}
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1200);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10" data-testid="dev-icon-gallery">
      <h1 className="text-3xl font-bold smn-heading">
        Icon Gallery <span className="text-sm font-normal smn-muted">— developer preview</span>
      </h1>
      <p className="smn-muted mt-1">
        {ALL.length} semantic icons × {TONES.length} tones. Pick a size, then click a swatch (or the name) to copy a
        tone/size-specific snippet.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <input
          data-testid="icon-filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter icons by name…"
          className="w-full sm:w-72 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm outline-none focus:border-[#55B3AD]"
        />
        <div className="flex items-center gap-1" data-testid="icon-size-picker">
          <span className="text-xs smn-muted mr-1">Size</span>
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              data-testid={`icon-size-btn-${s}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                size === s
                  ? "bg-[#1F3F5B] border-[#1F3F5B] text-white dark:bg-[#F2A03B] dark:border-[#F2A03B] dark:text-[#10233A]"
                  : "border-slate-200 dark:border-slate-700 smn-muted hover:border-[#55B3AD]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-8 space-y-1">
        {names.length === 0 && <div className="smn-muted py-6" data-testid="icon-empty">No icons match “{q}”.</div>}
        {names.map((n) => (
          <div
            key={n}
            className="flex items-center gap-4 border-b border-slate-200 dark:border-slate-800 py-3"
            data-testid={`icon-row-${n}`}
          >
            <button
              onClick={() => copy(n, "default")}
              data-testid={`icon-copy-${n}`}
              title={snippetFor(n, "default")}
              className="w-40 shrink-0 text-left text-sm font-mono smn-heading hover:text-[#B45309] dark:hover:text-[#F2A03B] transition-colors"
            >
              {copied === `${n}|default` ? "copied ✓" : n}
            </button>
            <div className="flex items-center gap-5 flex-wrap">
              {TONES.map((t) => (
                <button
                  key={t}
                  onClick={() => copy(n, t)}
                  data-testid={`icon-swatch-${n}-${t}`}
                  title={snippetFor(n, t)}
                  className="flex flex-col items-center gap-1 group"
                >
                  <div
                    className={`p-2 rounded-lg ring-1 ring-transparent group-hover:ring-[#55B3AD] transition-shadow ${
                      t === "current" ? "text-[#8B5CF6]" : ""
                    } ${t === "onAccent" ? "bg-[#F2A03B]" : "bg-slate-50 dark:bg-slate-900"}`}
                  >
                    <Icon name={n} size={size} tone={t} label={`${n} ${t}`} />
                  </div>
                  <span className="text-[10px] smn-muted">{copied === `${n}|${t}` ? "✓" : t}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
