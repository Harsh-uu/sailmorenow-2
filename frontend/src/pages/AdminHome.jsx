import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";

// Admin landing: a tappable button grid linking to every admin portal. Replaces
// the old hover dropdown (which kept disappearing). Mobile-width friendly.
const PORTALS = [
  { to: "/admin/moderation", label: "Moderation & disputes", icon: "shield-alert", desc: "Reports, reviews and dispute decisions" },
  { to: "/admin/reports", label: "Reports", icon: "flag", desc: "Flagged content queue" },
  { to: "/admin/events", label: "Events admin", icon: "events", desc: "Edit, delete and route event signups" },
  { to: "/admin/event-sources", label: "Event sources", icon: "refresh", desc: "Aggregator feeds and runs" },
  { to: "/admin/analytics", label: "Analytics", icon: "trending-up", desc: "Growth and engagement" },
  { to: "/admin/contact", label: "Contact queue", icon: "mail", desc: "Inbound contact messages" },
  { to: "/admin/email", label: "Email delivery", icon: "mail", desc: "Send failures and backup-route fallbacks" },
  { to: "/admin/comps", label: "Complimentary access", icon: "award", desc: "Grant, list and revoke free tiers" },
  { to: "/admin/billing", label: "Trials & billing", icon: "sparkles", desc: "Free-trial on/off and trial length" },
  { to: "/admin/sponsors", label: "Sponsors", icon: "award", desc: "Sponsor placements" },
  { to: "/admin/partners", label: "Partners", icon: "partner", desc: "Partner organizations" },
  { to: "/admin/referrals", label: "Referrals", icon: "user-plus", desc: "Referral tracking" },
  { to: "/admin/zoho", label: "Zoho sync", icon: "refresh", desc: "CRM contact sync" },
  { to: "/admin/demo", label: "Demo data", icon: "activity", desc: "Seed and reset demo data" },
  { to: "/admin/access", label: "Admin access", icon: "shield-alert", desc: "Grant or revoke admin (full access)" },
  { to: "/admin/verify-user", label: "Verify a user", icon: "mail", desc: "Mark an account verified (comp / reviewer logins)" },
];

export default function AdminHome() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
  }, [user, loading, nav]);

  if (loading) return null;
  if (!user || user.platform_role !== "admin") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center" data-testid="admin-home-denied">
        <Icon name="shield-alert" tone="current" className="h-12 w-12 text-orange-500 mx-auto" />
        <h1 className="mt-4 text-2xl font-display font-bold text-[#1F3F5B]">Admin access required.</h1>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10" data-testid="admin-home-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="shield-alert" tone="current" className="h-3.5 w-3.5" /> Admin
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Admin portals</h1>
      <p className="text-slate-500 mt-2 text-sm">Jump to any admin area.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-portal-grid">
        {PORTALS.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            data-testid={`admin-portal-${p.to.replace("/admin/", "")}`}
            className="group rounded-2xl border border-slate-100 bg-white p-4 shadow-sm hover:border-[#55B3AD] hover:shadow transition-colors flex items-start gap-3"
          >
            <span className="h-10 w-10 shrink-0 rounded-full bg-[#55B3AD]/15 text-[#2A7871] flex items-center justify-center">
              <Icon name={p.icon} tone="current" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-display font-bold text-[#1F3F5B] text-base group-hover:text-[#2A7871]">{p.label}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{p.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
