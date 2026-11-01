import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const KEY = "smn_renewal_reminder_dismissed_until";

function daysLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// In-app renewal reminder for Community Partners within 30 days of expiry.
export default function RenewalReminder() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => Number(localStorage.getItem(KEY) || 0) > Date.now());

  if (hidden || !user || user.subscription_tier !== "community_partner") return null;
  const left = daysLeft(user.subscription_expires);
  if (left === null || left > 30 || left < 0) return null;

  const dismiss = () => {
    localStorage.setItem(KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setHidden(true);
  };

  const contactRenew = async () => {
    setBusy(true);
    try {
      await api.post("/contact", {
        name: user.name || "Community Partner",
        email: user.email,
        subject: "Community Partner renewal",
        message: `Community Partner renewal request from ${user.name || user.email}. Term ends in ${left} day(s) (${user.subscription_expires}).`,
      });
      toast.success("Thanks — we'll reach out about renewing your term.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="renewal-reminder" className="relative rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-400/10 dark:border-amber-400/40 p-5">
      <button onClick={dismiss} data-testid="renewal-dismiss" aria-label="Dismiss" className="absolute top-3 right-3 text-amber-500 hover:text-amber-700">
        <Icon name="close" tone="current" className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="h-10 w-10 rounded-xl bg-amber-400/25 flex items-center justify-center shrink-0">
          <Icon name="clock" tone="current" className="h-5 w-5 text-amber-700 dark:text-amber-300" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-amber-900 dark:text-amber-200">
            Your Community Partner term ends in {left} day{left === 1 ? "" : "s"}
          </div>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/80 mt-1">
            Renew to keep your directory listing, event posting and messaging active.
          </p>
          <button onClick={contactRenew} disabled={busy} data-testid="renewal-contact-btn" className="mt-3 inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-full px-4 py-2 text-sm font-semibold">
            {busy ? "Sending…" : "Contact us to renew"}
          </button>
        </div>
      </div>
    </div>
  );
}
