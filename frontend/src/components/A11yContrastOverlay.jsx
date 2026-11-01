import { useState, useCallback } from "react";

/**
 * DEV-ONLY WCAG contrast checker overlay.
 *
 * Mounted only when process.env.NODE_ENV === "development" (see App.js), so it
 * never ships to end users. Scans every visible text-bearing element, computes
 * the contrast ratio of its text color against its effective (composited)
 * background, and flags anything below the WCAG AA threshold:
 *   - normal text  → 4.5:1
 *   - large text    → 3:1  (>=24px, or >=18.66px when bold)
 * Failures get a dashed red outline; a summary panel lists them and lets you
 * clear the highlights. Toggle with the floating button or Alt+Shift+C.
 */

const OUTLINE_ATTR = "data-a11y-flag";

function parseColor(str) {
  // getComputedStyle returns "rgb(r, g, b)" or "rgba(r, g, b, a)".
  const m = str && str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  const [r, g, b] = parts;
  const a = parts.length >= 4 ? parts[3] : 1;
  return { r, g, b, a };
}

function relLuminance({ r, g, b }) {
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function composite(over, under) {
  // Alpha-composite `over` (may be translucent) atop opaque `under`.
  const a = over.a;
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1,
  };
}

function effectiveBg(el) {
  // Walk ancestors compositing translucent backgrounds until fully opaque.
  let node = el;
  let acc = null; // top-most translucent layer, composited downward
  while (node && node instanceof Element) {
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0) {
      acc = acc ? composite(acc, bg) : bg;
      if (acc.a >= 1) return acc;
    }
    node = node.parentElement;
  }
  // Fall back to the page background (white-ish) if nothing opaque found.
  const body = parseColor(getComputedStyle(document.body).backgroundColor);
  const base = body && body.a >= 1 ? body : { r: 255, g: 255, b: 255, a: 1 };
  return acc ? composite(acc, base) : base;
}

function hasOwnText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0) return true;
  }
  return false;
}

function isLargeText(cs) {
  const size = parseFloat(cs.fontSize);
  const weight = parseInt(cs.fontWeight, 10) || 400;
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

export default function A11yContrastOverlay() {
  const [results, setResults] = useState(null); // {fails:[], total}
  const [open, setOpen] = useState(false);

  const clear = useCallback(() => {
    document.querySelectorAll(`[${OUTLINE_ATTR}]`).forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.removeAttribute(OUTLINE_ATTR);
    });
  }, []);

  const scan = useCallback(() => {
    clear();
    const fails = [];
    let total = 0;
    const all = document.querySelectorAll("body *:not(script):not(style):not(svg):not([data-a11y-overlay])");
    all.forEach((el) => {
      if (el.closest("[data-a11y-overlay]")) return;
      if (!hasOwnText(el)) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const fgRaw = parseColor(cs.color);
      if (!fgRaw) return;
      const bg = effectiveBg(el);
      const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
      const ratio = contrastRatio(fg, bg);
      const min = isLargeText(cs) ? 3 : 4.5;
      total += 1;
      if (ratio < min) {
        el.style.outline = "2px dashed #ff2d55";
        el.style.outlineOffset = "1px";
        el.setAttribute(OUTLINE_ATTR, "1");
        fails.push({
          text: (el.textContent || "").trim().slice(0, 60),
          ratio: ratio.toFixed(2),
          min,
          tag: el.tagName.toLowerCase(),
        });
      }
    });
    setResults({ fails, total });
    setOpen(true);
  }, [clear]);

  // Alt+Shift+C toggles a scan / clear.
  if (typeof window !== "undefined" && !window.__a11yHotkey) {
    window.__a11yHotkey = true;
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        document.querySelector("[data-a11y-scan-btn]")?.click();
      }
    });
  }

  return (
    <div
      data-a11y-overlay
      style={{ position: "fixed", right: 12, bottom: 12, zIndex: 2147483647, fontFamily: "ui-monospace, monospace" }}
    >
      {open && results && (
        <div
          style={{
            width: 320,
            maxHeight: "50vh",
            overflowY: "auto",
            background: "#0b1220",
            color: "#eef3f9",
            border: "1px solid #2c3a52",
            borderRadius: 12,
            padding: 12,
            marginBottom: 8,
            boxShadow: "0 10px 40px rgba(0,0,0,.5)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ color: results.fails.length ? "#ff8a9c" : "#6fe0a1" }}>
              {results.fails.length ? `${results.fails.length} contrast fail(s)` : "No AA failures 🎉"}
            </strong>
            <span style={{ opacity: 0.6 }}>{results.total} checked</span>
          </div>
          {results.fails.slice(0, 40).map((f, i) => (
            <div key={i} style={{ padding: "4px 0", borderTop: "1px solid #1b2740" }}>
              <span style={{ color: "#ff8a9c" }}>{f.ratio}:1</span>{" "}
              <span style={{ opacity: 0.55 }}>(need {f.min}:1, &lt;{f.tag}&gt;)</span>
              <div style={{ opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                “{f.text}”
              </div>
            </div>
          ))}
          {results.fails.length > 40 && <div style={{ opacity: 0.6, marginTop: 6 }}>…and {results.fails.length - 40} more</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {results && (
          <button
            onClick={() => { clear(); setOpen(false); setResults(null); }}
            style={{ background: "#1b2740", color: "#cbd7e6", border: "1px solid #2c3a52", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}
          >
            Clear
          </button>
        )}
        <button
          data-a11y-scan-btn
          onClick={scan}
          title="Check contrast (Alt+Shift+C)"
          style={{ background: "#F2A03B", color: "#10233A", border: "none", borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}
        >
          A11y ⚠ Contrast
        </button>
      </div>
    </div>
  );
}
