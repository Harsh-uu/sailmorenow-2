import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * Member review highlights (4+ stars) surfaced as testimonials. Each card shows
 * a 2-line snippet; tapping expands it to the full text. Renders nothing until
 * at least one highlight exists. `variant` tunes the palette (light / dark).
 */
function QuoteCard({ t, dark }) {
  const [open, setOpen] = useState(false);
  return (
    <figure
      data-testid={`testimonial-${t.id}`}
      onClick={() => setOpen((v) => !v)}
      className={`rounded-2xl p-6 border cursor-pointer transition-all hover:-translate-y-0.5 ${dark ? "bg-white/5 border-white/10" : "bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700"}`}
    >
      <div className="flex items-center gap-1 text-[#F2A03B]">
        {Array.from({ length: Math.min(5, Math.max(0, Math.round(t.rating || 5))) }).map((_, i) => (
          <Icon key={i} name="reviews" tone="current" className="h-4 w-4" />
        ))}
      </div>
      <blockquote
        data-testid={`testimonial-quote-${t.id}`}
        className={`mt-3 text-sm leading-relaxed ${dark ? "text-slate-100" : "text-slate-700 dark:text-slate-200"} ${open ? "" : "line-clamp-2"}`}
      >
        &ldquo;{t.quote}&rdquo;
      </blockquote>
      {!open && (t.quote || "").length > 90 && (
        <button data-testid={`testimonial-more-${t.id}`} className={`mt-1 text-xs font-semibold ${dark ? "text-[#7fcac4]" : "text-[#2A7871] dark:text-[#7fcac4]"}`}>Read more</button>
      )}
      <figcaption className={`mt-4 text-xs ${dark ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
        {t.attribution ? <span className="font-bold">{t.attribution}</span> : null}
        {t.attribution && t.market ? " · " : null}
        <span className="capitalize">{t.market || ""}</span>
      </figcaption>
    </figure>
  );
}

export default function TestimonialsStrip({ variant = "light", title = "What sailors are saying" }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.get("/review-highlights").then(({ data }) => setItems(Array.isArray(data) ? data : [])).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  const dark = variant === "dark";
  return (
    <section className={dark ? "py-12 sm:py-16" : "py-12 sm:py-16 bg-white dark:bg-slate-900"} data-testid="testimonials-strip">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className={`font-display font-extrabold text-2xl sm:text-3xl text-center ${dark ? "text-white" : "text-[#1F3F5B] dark:text-slate-100"}`}>{title}</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((t) => (
            <QuoteCard key={t.id} t={t} dark={dark} />
          ))}
        </div>
      </div>
    </section>
  );
}
