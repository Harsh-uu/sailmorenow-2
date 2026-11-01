import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

// Admin tool: mark an account's email verified (e.g. App Store reviewer demo
// logins). Exempts the account from the 24h verification lock. Audit-logged.
export default function AdminVerifyUser() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!user || user.platform_role !== "admin") {
    return <div className="max-w-xl mx-auto px-6 py-16 text-center text-[#1F3F5B] font-bold">Admin access required.</div>;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) return toast.error("Enter a valid email.");
    if (!reason.trim()) return toast.error("A reason is required.");
    setBusy(true);
    try {
      await api.post("/admin/users/verify-email", { email: email.trim().toLowerCase(), reason: reason.trim() });
      toast.success(`Marked ${email.trim()} verified.`);
      setEmail(""); setReason("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10" data-testid="admin-verify-user-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Admin
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl mt-2">Verify a user by admin</h1>
      <p className="text-slate-500 mt-2 text-sm">
        Marks an account's email verified and exempts it from the 24-hour lock. Use for comp or App
        Store reviewer demo logins. This is audit-logged.
      </p>
      <form onSubmit={submit} className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Account email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="admin-verify-email"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#55B3AD] focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Reason (required)</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="admin-verify-reason"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#55B3AD] focus:outline-none" />
        </div>
        <button type="submit" disabled={busy} data-testid="admin-verify-submit"
          className="rounded-full bg-[#1F3F5B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#162f45] disabled:opacity-50">
          {busy ? "Saving…" : "Mark verified"}
        </button>
      </form>
    </div>
  );
}
