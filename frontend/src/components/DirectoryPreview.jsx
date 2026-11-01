import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import SectionEyebrow from "@/components/SectionEyebrow";
import { useMarket } from "@/context/MarketContext";
import { api } from "@/lib/api";

// Static, non-clickable preview categories. These are NOT real listings — no
// vendor names, contact, ratings or badges are ever shown to visitors.
const PREVIEW_CATEGORIES = [
  { name: "Boat Haul Out", image: "https://images.unsplash.com/photo-1775635901432-9c1bc80ef094?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
  { name: "Detailing", image: "https://images.unsplash.com/photo-1785013045447-92e088e00fa1?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
  { name: "Diesel Engine Service", image: "https://images.unsplash.com/photo-1552656967-7a0991a13906?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
  { name: "Rigging", image: "https://images.unsplash.com/photo-1524722228493-c418381c4cac?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
  { name: "Sails/Canvas", image: "https://images.unsplash.com/photo-1603275218135-07c03485bba9?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
  { name: "Sailing Instruction", image: "https://images.unsplash.com/photo-1474917518260-23f84bd71c75?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" },
];

export default function DirectoryPreview() {
  const nav = useNavigate();
  const { market, setMarket } = useMarket();
  const [active, setActive] = useState(null);
  const [markets, setMarkets] = useState([]);

  useEffect(() => { api.get("/markets").then(({ data }) => setMarkets(data.markets || [])).catch(() => {}); }, []);

  const localized = market && market !== "all" ? ` in ${market}` : " in your area";

  return (
    <section className="py-16 sm:py-20 bg-white dark:bg-slate-900" data-testid="directory-preview">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow>Marine service directory</SectionEyebrow>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl smn-heading mt-3">Find trusted Boat Pros</h2>
          <p className="mt-3 text-slate-500 dark:text-slate-400">
            Riggers, mechanics, sailmakers and more — vetted by the PNW sailing community. Create a free account to browse the full directory.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-4 pr-2 py-1.5">
            <Icon name="location" tone="current" className="h-4 w-4 text-[#55B3AD]" />
            <label htmlFor="preview-market" className="text-sm text-slate-500 dark:text-slate-400">Your market</label>
            <select id="preview-market" value={market} onChange={(e) => setMarket(e.target.value)} data-testid="preview-market-picker"
                    className="bg-transparent text-sm font-semibold text-[#1F3F5B] dark:text-slate-100 focus:outline-none cursor-pointer pr-1">
              <option value="all">All markets</option>
              {markets.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {PREVIEW_CATEGORIES.map((c) => (
            <button
              key={c.name}
              onClick={() => setActive(c)}
              data-testid={`preview-card-${c.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`}
              className="group relative text-left rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all focus:outline-none focus:ring-2 focus:ring-[#55B3AD]"
            >
              <div className="h-44 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                <img src={c.image} alt={c.name} loading="lazy"
                     className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d2436]/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 flex items-center justify-between">
                <h3 className="font-display font-bold text-lg text-white">{c.name}</h3>
                <Icon name="lock" tone="current" className="h-4 w-4 text-white/80" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
             onClick={() => setActive(null)} data-testid="preview-cta-overlay">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-8 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="inline-flex h-14 w-14 rounded-2xl bg-[#55B3AD]/15 items-center justify-center mb-4">
              <Icon name="directory" tone="current" className="h-7 w-7 text-[#55B3AD]" />
            </div>
            <h3 className="font-display font-extrabold text-xl sm:text-2xl smn-heading">
              Find the best {active.name} pros{localized}
            </h3>
            <p className="mt-3 text-slate-500 dark:text-slate-400">Create a free account to browse the full directory.</p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={() => nav("/register")} data-testid="preview-cta-signup"
                      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white font-semibold px-6 py-3 transition-colors">
                <Icon name="user-plus" tone="current" className="h-4 w-4" /> Create an account
              </button>
              <button onClick={() => nav("/login")} data-testid="preview-cta-login"
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 dark:border-slate-600 text-[#1F3F5B] dark:text-slate-100 font-semibold px-6 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Log in
              </button>
            </div>
            <button onClick={() => setActive(null)} className="mt-4 text-sm text-slate-400 hover:text-slate-600">Maybe later</button>
          </div>
        </div>
      )}
    </section>
  );
}
