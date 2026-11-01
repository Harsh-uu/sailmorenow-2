import { useSearchParams } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";

// Shown only to logged-out visitors (e.g. someone who followed a shared link).
// Gives a warm, personalized nudge to create a free account.
export default function InviteBanner({ blurb }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user) return null;
  const ref = params.get("ref");

  const signup = () => {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    window.location.href = `/register${q}`;
  };

  return (
    <div
      data-testid="invite-banner"
      className="mb-6 rounded-2xl border border-[#55B3AD]/40 bg-gradient-to-r from-[#1F3F5B] to-[#2b567a] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="h-11 w-11 rounded-full bg-white/15 flex items-center justify-center shrink-0">
        <Icon name="anchor" tone="current" className="h-5 w-5 text-[#F2A03B]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8fd6d0]">
          {ref ? `${ref} invited you to Sail More Now` : "Join Sail More Now"}
        </div>
        <p className="text-sm text-slate-100 mt-1 leading-relaxed">
          {blurb ||
            "Create your free account to join the Pacific Northwest sailing community — connect with Boat Pros, RSVP to events, join crews, and more."}
        </p>
      </div>
      <button
        onClick={signup}
        data-testid="invite-signup-btn"
        className="shrink-0 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-2.5 font-semibold text-sm transition-colors"
      >
        Create an account
      </button>
    </div>
  );
}
