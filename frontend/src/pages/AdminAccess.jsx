import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const PENDING_KEY = "smn_admin_access_pending";

// Send the admin through a FRESH Google sign-in, then resume the pending action.
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
function reauthThen(action, email, reason) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ action, email, reason }));
    sessionStorage.setItem("smn_post_auth", "/admin/access");
  } catch {}
  const redirectUrl = window.location.origin + "/admin/access";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

export default function AdminAccess() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    api.get("/admin/admins")
      .then(({ data }) => setAdmins(data.admins || []))
      .catch(() => toast.error("Couldn't load admins"))
      .finally(() => setLoaded(true));
  }, []);

  // Resume a grant/revoke queued right before a re-auth round-trip.
  useEffect(() => {
    if (loading || !user || user.platform_role !== "admin") return;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch {}
    if (pending) {
      sessionStorage.removeItem(PENDING_KEY);
      const url = pending.action === "revoke" ? "/admin/admins/revoke" : "/admin/admins/grant";
      api.post(url, { email: pending.email, reason: pending.reason })
        .then(() => toast.success(pending.action === "revoke" ? "Admin access revoked" : "Admin access granted"))
        .catch((e) => {
          const d = e?.response?.data?.detail;
          toast.error(d === "reauth_required" ? "Please re-confirm with Google and try again." : (d || "Action failed"));
        })
        .finally(load);
    } else {
      load();
    }
  }, [user, loading, load]);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); }
  }, [user, loading, nav]);

  if (loading) return null;
  if (!user || user.platform_role !== "admin") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center" data-testid="admin-access-denied">
        <Icon name="shield-alert" tone="current" className="h-12 w-12 text-orange-500 mx-auto" />
        <h1 className="mt-4 text-2xl font-display font-bold text-[#1F3F5B]">Admin access required.</h1>
      </div>
    );
  }

  const submitGrant = (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !em.includes("@")) { toast.error("Enter a valid email."); return; }
    if (!reason.trim()) { toast.error("A reason is required."); return; }
    if (!window.confirm(`Grant FULL admin to ${em}? You'll re-confirm with Google first.`)) return;
    reauthThen("grant", em, reason.trim());
  };

  const revoke = (adminRow) => {
    if (admins.length <= 1) { toast.error("You can't remove the last admin."); return; }
    const r = window.prompt(`Reason for revoking admin from ${adminRow.email}? (optional)`) || "";
    if (!window.confirm(`Revoke admin from ${adminRow.email}? You'll re-confirm with Google first.`)) return;
    reauthThen("revoke", adminRow.email, r.trim());
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10" data-testid="admin-access-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="shield-alert" tone="current" className="h-3.5 w-3.5" /> Admin
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Admin access</h1>
      <p className="text-slate-500 mt-2 text-sm">
        Grant FULL admin to an existing account. The person must have signed in with Google at least
        once. Granting and revoking each need you to re-confirm with Google first. The last admin
        can't be removed.
      </p>

      <form onSubmit={submitGrant} className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-4" data-testid="admin-grant-card">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Account email</label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            data-testid="admin-grant-email" placeholder="person@sailmorenow.com"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#55B3AD] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Reason (required)</label>
          <input
            type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            data-testid="admin-grant-reason" placeholder="Why this person needs admin"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#55B3AD] focus:outline-none"
          />
        </div>
        <button type="submit" data-testid="admin-grant-submit"
          className="inline-flex items-center gap-2 rounded-full bg-[#1F3F5B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#162f45] transition-colors">
          <Icon name="shield-alert" tone="current" className="h-4 w-4" /> Grant admin (re-confirm with Google)
        </button>
      </form>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm" data-testid="admin-list-card">
        <h2 className="font-display font-bold text-[#1F3F5B] text-lg">Current admins</h2>
        {!loaded ? (
          <p className="text-slate-400 text-sm mt-3">Loading…</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100" data-testid="admin-list">
            {admins.map((a) => (
              <li key={a.user_id} className="py-3 flex items-center justify-between gap-3" data-testid={`admin-row-${a.email}`}>
                <div className="min-w-0">
                  <div className="font-semibold text-[#1F3F5B] text-sm truncate">{a.name || a.handle}</div>
                  <div className="text-xs text-slate-500 truncate">{a.email}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    granted by {a.granted_by}{a.granted_at ? ` · ${new Date(a.granted_at).toLocaleDateString([], { timeZone: "America/Los_Angeles" })}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => revoke(a)} disabled={admins.length <= 1}
                  data-testid={`admin-revoke-${a.email}`}
                  className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
