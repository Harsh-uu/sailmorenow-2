import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import RenewalReminder from "@/components/RenewalReminder";
import UpgradeNudge from "@/components/UpgradeNudge";

const ROLE_LABEL = { sailor: "Sailor", boat_owner: "Boat Owner", boat_pro: "Boat Pro", partner: "Organization" };

// Role-tailored quick actions — Pro manages a listing, Org manages events,
// Sailor leans into crew + community, Owner keeps the original set.
function cardsFor(user) {
  const at = user.account_type;
  if (at === "boat_pro") return [
    { title: "Manage your listing", desc: "Views, contacts, photos & the markets you serve.", to: "/my-listing", icon: "edit" },
    { title: "Upgrade your plan", desc: "Unlock featured placement in the directory.", to: "/pricing", icon: "reviews" },
    { title: "Your public page", desc: "See how owners find and review you.", to: user.handle ? `/u/${user.handle}` : "/directory", icon: "messages" },
  ];
  if (at === "partner") return [
    { title: "Manage events", desc: "RSVPs, check-in exports, edits & cancellations.", to: "/my-events", icon: "events" },
    { title: "Post an event", desc: "Add a regatta, class, rendezvous or volunteer day.", to: "/events?post=1", icon: "myEvents" },
    { title: "Community feed", desc: "Reach sailors and owners directly.", to: "/feed", icon: "community" },
  ];
  if (at === "sailor") return [
    { title: "Crew Bank", desc: "Find boats to race and cruise on.", to: "/crew-bank", icon: "crew" },
    { title: "Community Hub", desc: "Forums, blogs and the live feed.", to: "/community-hub", icon: "hub" },
    { title: "Events calendar", desc: "Regattas, rendezvous, and clinics.", to: "/events", icon: "events" },
  ];
  return [
    { title: "Find a Boat Pro", desc: "Riggers, mechanics, sailmakers, and more.", to: "/directory", icon: "boatPro" },
    { title: "Community feed", desc: "Crew openings and volunteer opportunities.", to: "/feed", icon: "community" },
    { title: "Events calendar", desc: "Regattas, rendezvous, and clinics.", to: "/events", icon: "events" },
  ];
}

export default function Dashboard() {
  const { user, loading } = useAuth();
  const { market } = useMarket();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) nav("/");
    else if (user && !user.onboarding_complete) nav("/onboarding");
  }, [user, loading, nav]);

  if (!user) return null;

  const isFree = user.subscription_tier === "free";
  const cards = cardsFor(user);
  const roleLabel = ROLE_LABEL[user.account_type] || "Member";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="dashboard-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]" data-testid="dash-role">{roleLabel} · Your home port</div>
          <h1 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-1">Ahoy, {user.name?.split(" ")[0]}.</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">Viewing <b className="smn-heading">{market === "all" ? "all PNW markets" : market}</b>. Change from the header any time.</p>
        </div>
        {isFree && user.account_type !== "boat_pro" && user.account_type !== "partner" && (
          <Link
            to="/pricing"
            data-testid="upgrade-cta"
            className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold text-sm"
          >
            <Icon name="sparkles" tone="current" className="h-4 w-4" /> Upgrade to Premium
          </Link>
        )}
      </div>

      <div className="mt-6"><UpgradeNudge /></div>
      <div className="mt-4"><RenewalReminder /></div>

      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {cards.map(({ title, desc, to, icon }) => (
          <Link
            key={title}
            to={to}
            data-testid={`dash-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all"
          >
            <div className="h-10 w-10 rounded-full bg-[#55B3AD]/15 text-[#1F3F5B] dark:text-[#7fcac4] flex items-center justify-center">
              <Icon name={icon} size={20} tone="current" />
            </div>
            <h3 className="font-display font-bold text-xl smn-heading mt-4">{title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
