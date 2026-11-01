import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * Community Sponsor banner rotator shown below the Events calendar. Cycles
 * sponsors every 5s, pauses on hover, each banner opens the sponsor site in a
 * new tab. Empty state shows a "Become a Sponsor" card that opens a prefilled
 * email. Intentionally NOT labeled as ads.
 */
export default function SponsorCarousel() {
  const [sponsors, setSponsors] = useState(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    api.get("/sponsors").then(({ data }) => setSponsors(Array.isArray(data) ? data : [])).catch(() => setSponsors([]));
  }, []);

  useEffect(() => {
    if (!sponsors || sponsors.length <= 1 || paused) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % sponsors.length), 5000);
    return () => clearInterval(timer.current);
  }, [sponsors, paused]);

  if (sponsors === null) return null;

  return (
    <section className="mt-5" data-testid="community-sponsor">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD] mb-2">Community Sponsor</div>
      {sponsors.length === 0 ? (
        <a
          href="mailto:info@sailmorenow.com?subject=Community%20Sponsor%20inquiry"
          data-testid="become-sponsor-card"
          className="block rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-5 text-center hover:border-[#F2A03B] transition-colors"
        >
          <Icon name="award" tone="current" className="h-7 w-7 text-[#F2A03B] mx-auto" />
          <div className="font-display font-bold smn-heading mt-2">Become a Sponsor</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Support PNW sailing and reach the community. Tap to get in touch.</div>
        </a>
      ) : (
        <div
          className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          data-testid="sponsor-rotator"
        >
          {sponsors.map((s, i) => (
            <a
              key={s.id}
              href={s.link_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`sponsor-banner-${i}`}
              className={`block ${i === idx ? "" : "hidden"}`}
            >
              <img src={s.image_url} alt={s.name || "Community sponsor"} className="w-full h-auto object-cover" />
            </a>
          ))}
          {sponsors.length > 1 && (
            <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
              {sponsors.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setIdx(i)}
                  aria-label={`Sponsor ${i + 1}`}
                  data-testid={`sponsor-dot-${i}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-white" : "w-1.5 bg-white/60"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
