import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { canInteract } from "@/lib/plan";

const KEY = "smn_upgrade_nudge_dismissed_until";

// Gentle, dismissible banner for FREE Sailors & Boat Owners highlighting what a
// $6.99/mo upgrade unlocks. Hidden for 30 days after dismissal.
export default function UpgradeNudge() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState(() => {
    const until = Number(localStorage.getItem(KEY) || 0);
    return until > Date.now();
  });

  if (hidden || !user) return null;
  const eligible = ["sailor", "boat_owner"].includes(user.account_type) && !canInteract(user);
  if (!eligible) return null;

  const dismiss = () => {
    localStorage.setItem(KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    setHidden(true);
  };

  return (
    <div data-testid="upgrade-nudge" className="relative overflow-hidden rounded-2xl border border-[#F2A03B]/40 bg-gradient-to-r from-[#F2A03B]/[0.10] to-[#55B3AD]/[0.08] dark:from-[#F2A03B]/[0.14] dark:to-[#55B3AD]/[0.12] p-5">
      <button onClick={dismiss} data-testid="upgrade-nudge-dismiss" aria-label="Dismiss" className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
        <Icon name="close" tone="current" className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="h-10 w-10 rounded-xl bg-[#F2A03B]/20 flex items-center justify-center shrink-0">
          <Icon name="sparkles" tone="current" className="h-5 w-5 text-[#d98c30]" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold smn-heading">Get the most out of Sail More Now</div>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            For <b>$6.99/mo</b>, unlock direct messaging, posting &amp; reactions, leaving reviews, and listing yourself in the Crew Bank.
          </p>
          <Link to="/my-plan" data-testid="upgrade-nudge-cta" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#d98c30] hover:text-[#b5741f]">
            See what's included <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
