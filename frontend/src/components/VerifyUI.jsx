import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const SUPPORT_URL = "/contact";

async function resendVerification() {
  await api.post("/auth/send-verification");
}

async function changeEmailFlow(refresh) {
  const next = window.prompt("Enter the correct email address. We'll send a new verification link there.");
  if (!next || !next.trim()) return;
  try {
    await api.post("/auth/change-email", { email: next.trim() });
    toast.success("Email updated. Check your inbox for a new verification link.");
    refresh();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Couldn't change your email.");
  }
}

// Thin countdown banner shown while an account is unverified but still inside the
// 24h grace window. Polls the user's own /me so the original tab notices when the
// person verifies on another device, without losing their place.
export function VerifyBanner() {
  const { user, refresh } = useAuth();
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);
  const v = user?.verification;

  useEffect(() => {
    if (!user || !v?.required || v?.locked) return;
    timer.current = setInterval(() => { refresh(); }, 20000);
    return () => clearInterval(timer.current);
  }, [user, v?.required, v?.locked, refresh]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!user || !v?.required || v?.locked) return null;
  const hours = Math.max(0, Math.ceil(v.hours_remaining ?? 0));

  const resend = async () => {
    if (cooldown > 0) return;
    try {
      await resendVerification();
      toast.success("Verification email sent.");
      setCooldown(30);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send the email.");
    }
  };

  return (
    <div data-testid="verify-banner" className="bg-[#F2A03B] text-[#10233A]">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <Icon name="mail" tone="current" className="h-4 w-4 shrink-0" />
        <span className="font-semibold">Verify your email within {hours} {hours === 1 ? "hour" : "hours"} to keep your account.</span>
        <div className="flex items-center gap-2 ml-auto">
          <button data-testid="verify-resend-btn" onClick={resend} disabled={cooldown > 0}
            className="rounded-full bg-[#10233A] text-white px-3 py-1 text-xs font-bold hover:bg-[#1F3F5B] disabled:opacity-50">
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          </button>
          <button data-testid="verify-fix-email-btn" onClick={() => changeEmailFlow(refresh)}
            className="rounded-full border border-[#10233A] px-3 py-1 text-xs font-bold hover:bg-[#10233A]/10">
            Wrong email? Fix it
          </button>
        </div>
      </div>
    </div>
  );
}

// Full-screen gate shown once a long-unverified account is locked. No app access
// until verified: resend, fix email, sign out, contact support.
export function VerifyLocked() {
  const { user, refresh, logout } = useAuth();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (cooldown > 0) return;
    try { await resendVerification(); toast.success("Verification email sent."); setCooldown(30); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't send the email."); }
  };

  return (
    <div data-testid="verify-locked" className="max-w-lg mx-auto px-6 py-16 text-center">
      <div className="mx-auto h-14 w-14 rounded-full bg-[#F2A03B]/20 flex items-center justify-center">
        <Icon name="mail" tone="current" className="h-7 w-7 text-[#F2A03B]" />
      </div>
      <h1 className="mt-5 text-2xl font-display font-extrabold text-[#1F3F5B]">Verify your email to continue</h1>
      <p className="mt-2 text-slate-500 text-sm">
        Your 24-hour window has ended. Please verify {user?.verification?.email || "your email"} to unlock
        posting, messaging and checkout. The link we emailed still works.
      </p>
      <div className="mt-6 flex flex-col gap-2.5">
        <button data-testid="verify-locked-resend" onClick={resend} disabled={cooldown > 0}
          className="rounded-full bg-[#1F3F5B] text-white px-5 py-2.5 text-sm font-bold hover:bg-[#162f45] disabled:opacity-50">
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
        </button>
        <button data-testid="verify-locked-fix-email" onClick={() => changeEmailFlow(refresh)}
          className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:border-[#55B3AD]">
          Wrong email? Fix it
        </button>
        <div className="flex items-center justify-center gap-4 mt-1 text-xs">
          <a href={SUPPORT_URL} data-testid="verify-locked-support" className="text-[#55B3AD] font-semibold hover:underline">Contact support</a>
          <button data-testid="verify-locked-signout" onClick={logout} className="text-slate-400 font-semibold hover:underline">Sign out</button>
        </div>
      </div>
    </div>
  );
}
