import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// Verification landing page. The token is the proof, so this works signed-out, in
// a new tab, or on another device. We PEEK (read-only) first to see which account
// the link belongs to, then:
//  - different account signed in: do NOT verify; offer sign-out-and-continue.
//  - same account or signed out: verify and show the result.
// This guarantees a result never looks like it applies to a different signed-in
// account. See /app/memory/VERIFY-PAGE-1.md.
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, loading, refresh, setUser } = useAuth();
  // loading | verifying | different | success_same | success_out | stayed | error
  const [phase, setPhase] = useState("loading");
  const [masked, setMasked] = useState("");
  const [already, setAlready] = useState(false);
  const ran = useRef(false);
  const token = params.get("token") || "";

  const idOf = (u) => (u ? (u.user_id || u.id) : null);

  const doVerify = async (sameAccount) => {
    setPhase("verifying");
    try {
      const { data } = await api.post("/auth/verify-email", { token });
      setAlready(!!data.already_verified);
      if (data.email_masked) setMasked(data.email_masked);
      if (sameAccount) refresh();
      setPhase(sameAccount ? "success_same" : "success_out");
    } catch {
      setPhase("error");
    }
  };

  useEffect(() => {
    if (loading) return;           // hold "Verifying..." until the session resolves
    if (ran.current) return;
    ran.current = true;
    if (!token) { setPhase("error"); return; }
    (async () => {
      try {
        const { data: peek } = await api.post("/auth/verify-email/peek", { token });
        if (!peek.valid) { setPhase("error"); return; }
        setMasked(peek.email_masked || "");
        const sameAccount = !!user && idOf(user) === peek.user_id;
        if (user && !sameAccount) { setPhase("different"); return; }
        await doVerify(sameAccount);
      } catch {
        setPhase("error");
      }
    })();
  }, [loading, user, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOutAndContinue = async () => {
    setPhase("verifying");
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    await doVerify(false);
  };

  const Shell = ({ children, testid }) => (
    <div className="max-w-md mx-auto px-6 py-20 text-center" data-testid={testid}>{children}</div>
  );
  const SuccessIcon = () => (
    <div className="mx-auto h-14 w-14 rounded-full bg-[#55B3AD]/15 flex items-center justify-center">
      <Icon name="check" tone="current" className="h-7 w-7 text-[#55B3AD]" />
    </div>
  );

  if (phase === "loading" || phase === "verifying") {
    return <Shell testid="verify-email-page"><p className="text-slate-500">Verifying your email…</p></Shell>;
  }

  if (phase === "different") {
    return (
      <Shell testid="verify-email-different">
        <div className="mx-auto h-14 w-14 rounded-full bg-[#F2A03B]/15 flex items-center justify-center">
          <Icon name="info" tone="current" className="h-7 w-7 text-[#F2A03B]" />
        </div>
        <h1 className="mt-5 text-2xl font-display font-extrabold text-[#1F3F5B]">Different account</h1>
        <p className="mt-2 text-slate-600 text-sm">This link is for a different account than the one you're signed in to. Sign out to use it.</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <button onClick={signOutAndContinue} data-testid="verify-signout-continue" className="rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Sign out and continue</button>
          <button onClick={() => setPhase("stayed")} data-testid="verify-stay" className="text-sm font-semibold text-[#2A7871] hover:underline">Stay signed in</button>
        </div>
      </Shell>
    );
  }

  if (phase === "success_same") {
    return (
      <Shell testid="verify-email-success">
        <SuccessIcon />
        <h1 className="mt-5 text-2xl font-display font-extrabold text-[#1F3F5B]">{already ? "Already verified" : "Email verified"}</h1>
        <p className="mt-2 text-slate-500 text-sm">{already ? "This email is already verified. Your account is active." : "Thanks. Your account is fully active."}</p>
        <Link to="/community" data-testid="verify-go-app" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Go to the app</Link>
      </Shell>
    );
  }

  if (phase === "success_out") {
    return (
      <Shell testid="verify-email-success">
        <SuccessIcon />
        <h1 className="mt-5 text-2xl font-display font-extrabold text-[#1F3F5B]">{already ? "Already verified" : "Email verified"}</h1>
        <p className="mt-2 text-slate-500 text-sm">{already ? `This email${masked ? ` (${masked})` : ""} is already verified. You can sign in now.` : `Email verified${masked ? ` for ${masked}` : ""}. You can sign in now.`}</p>
        <Link to="/login" data-testid="verify-sign-in" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Sign in</Link>
      </Shell>
    );
  }

  if (phase === "stayed") {
    return (
      <Shell testid="verify-email-stayed">
        <h1 className="text-2xl font-display font-extrabold text-[#1F3F5B]">No change made</h1>
        <p className="mt-2 text-slate-500 text-sm">You're still signed in to your current account. The link is unused and stays valid until it expires.</p>
        <Link to="/community" data-testid="verify-stay-go-app" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Go to the app</Link>
      </Shell>
    );
  }

  return (
    <Shell testid="verify-email-error">
      <h1 className="text-2xl font-display font-extrabold text-[#1F3F5B]">Link invalid or expired</h1>
      <p className="mt-2 text-slate-500 text-sm">Sign in and tap "Resend email" to get a fresh verification link.</p>
      <Link to="/login" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Sign in</Link>
    </Shell>
  );
}
