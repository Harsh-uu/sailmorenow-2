import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import Avatar from "@/components/Avatar";
import SectionEyebrow from "@/components/SectionEyebrow";

// "Founding Partners" honor roll — hidden entirely when there are none yet.
export default function FoundingWall() {
  const [founders, setFounders] = useState([]);

  useEffect(() => {
    api.get("/founding-partners").then(({ data }) => setFounders(data.founders || [])).catch(() => {});
  }, []);

  if (!founders.length) return null;

  return (
    <section className="bg-[#1F3F5B] text-white py-14 sm:py-16" data-testid="founding-wall">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <SectionEyebrow tone="white" className="!text-[#F2A03B] justify-center flex">
          <Icon name="reviews" tone="current" className="h-3.5 w-3.5 fill-current" /> Founding Partners
        </SectionEyebrow>
        <h2 className="font-display font-extrabold text-2xl sm:text-3xl mt-2">The clubs who launched with us</h2>
        <p className="text-slate-300 mt-3 max-w-xl mx-auto text-sm">
          A heartfelt thanks to our founding Community Partners for helping build the Pacific Northwest sailing community.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {founders.map((f) => (
            <Link
              key={f.handle || f.name}
              to={f.handle ? `/partners/${f.handle}` : "#"}
              data-testid={`founder-${f.handle || f.name}`}
              className="w-40 rounded-2xl bg-white/5 border border-white/10 hover:border-[#F2A03B]/60 hover:bg-white/10 transition-colors p-4 flex flex-col items-center"
            >
              <div className="relative">
                <Avatar src={f.avatar || f.picture} alt={f.name} className="h-16 w-16 ring-2 ring-[#F2A03B]/50" />
                <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-[#F2A03B] flex items-center justify-center ring-2 ring-[#1F3F5B]">
                  <Icon name="reviews" tone="current" className="h-3 w-3 text-white fill-current" />
                </div>
              </div>
              <div className="mt-3 font-semibold text-sm text-center leading-tight">{f.name}</div>
              {f.primary_market && (
                <div className="text-[11px] text-slate-300 flex items-center gap-1 mt-1">
                  <Icon name="location" tone="current" className="h-2.5 w-2.5" /> {f.primary_market}
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
