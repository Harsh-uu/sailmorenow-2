import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";

// Guided highlight reel for prospect demos. Walks through the key surfaces;
// the admin triggers it from the Demo data page after loading sample data.
const STEPS = [
  { route: "/directory", icon: "directory", title: "Boat Pro directory",
    body: "Start here: a vetted directory of marine pros across all six service categories — haul-out, diesel, rigging, sails & canvas, detailing, and sailing instruction. Filter by market and category." },
  { route: "/community", icon: "community", title: "Community feed",
    body: "The heart of the app — announcements, notes, and discussions from PNW sailors. Members like, comment, and reply in real time." },
  { route: "/community?tab=marketplace", icon: "tag", title: "Marketplace",
    body: "Buy and sell gear and boats. Members can make an offer, save searches, get price-drop nudges, and relist in one tap." },
  { route: "/events", icon: "events", title: "Events & RSVPs",
    body: "A live calendar of races, rendezvous, and volunteer days. One-tap RSVP, add to calendar, and message the hosting club." },
  { route: "/events", icon: "crew", title: "Per-event crew spots",
    body: "Right on each event, organizers post open crew spots for that specific race or delivery — sailors claim a spot in one tap." },
  { route: "/crew-bank", icon: "crew", title: "Crew Bank",
    body: "Standalone from any event: sailors list their availability and skills anytime, and boat owners reach out to build a crew." },
];

const DemoTourCtx = createContext({ start: () => {} });
export const useDemoTour = () => useContext(DemoTourCtx);

export function DemoTourProvider({ children }) {
  const nav = useNavigate();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  const start = useCallback(() => { setStep(0); setActive(true); }, []);
  const exit = useCallback(() => setActive(false), []);

  useEffect(() => {
    if (active) nav(STEPS[step].route);
  }, [active, step, nav]);

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <DemoTourCtx.Provider value={{ start }}>
      {children}
      {active && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[min(94vw,520px)]" data-testid="demo-tour">
          <div className="rounded-2xl bg-[#1F3F5B] text-white shadow-2xl border border-white/10 p-5">
            <div className="flex items-center gap-2 text-[#7fcac4] text-xs font-bold uppercase tracking-widest">
              <Icon name={s.icon} tone="current" className="h-4 w-4" />
              Demo tour · Step {step + 1} of {STEPS.length}
            </div>
            <h3 className="font-display font-extrabold text-xl mt-2">{s.title}</h3>
            <p className="mt-1.5 text-sm text-slate-200 leading-relaxed">{s.body}</p>
            <div className="mt-3 flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-[#F2A03B]" : "w-1.5 bg-white/25"}`} />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button onClick={exit} data-testid="demo-tour-exit" className="text-sm text-slate-300 hover:text-white">Exit tour</button>
              <div className="flex gap-2">
                <button onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0} data-testid="demo-tour-back"
                        className="rounded-full px-4 py-2 text-sm font-semibold border border-white/25 text-white disabled:opacity-40 hover:bg-white/10">Back</button>
                {isLast ? (
                  <button onClick={exit} data-testid="demo-tour-finish"
                          className="rounded-full px-5 py-2 text-sm font-semibold bg-[#F2A03B] text-white hover:bg-[#d98c30]">Finish</button>
                ) : (
                  <button onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))} data-testid="demo-tour-next"
                          className="rounded-full px-5 py-2 text-sm font-semibold bg-[#F2A03B] text-white hover:bg-[#d98c30]">Next</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DemoTourCtx.Provider>
  );
}
