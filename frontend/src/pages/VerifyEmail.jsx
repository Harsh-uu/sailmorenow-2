import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// Verification landing page. The token is the proof, so this works signed-out, in
// a new tab, or on another device. If the person is signed in here, refresh() flips
// their banner/lock without losing their place.
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState("verifying"); // verifying | done | error
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) { setStatus("error"); return; }
    api.post("/auth/verify-email", { token })
      .then(() => { setStatus("done"); if (user) refresh(); })
      .catch(() => setStatus("error"));
  }, [params, user, refresh]);

  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center" data-testid="verify-email-page">
      {status === "verifying" && <p className="text-slate-500">Verifying your email…</p>}
      {status === "done" && (
        <div data-testid="verify-email-success">
          <div className="mx-auto h-14 w-14 rounded-full bg-[#55B3AD]/15 flex items-center justify-center">
            <Icon name="check" tone="current" className="h-7 w-7 text-[#55B3AD]" />
          </div>
          <h1 className="mt-5 text-2xl font-display font-extrabold text-[#1F3F5B]">Email verified</h1>
          <p className="mt-2 text-slate-500 text-sm">Thanks. Your account is fully active.</p>
          <Link to="/community" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Go to the app</Link>
        </div>
      )}
      {status === "error" && (
        <div data-testid="verify-email-error">
          <h1 className="text-2xl font-display font-extrabold text-[#1F3F5B]">Link invalid or expired</h1>
          <p className="mt-2 text-slate-500 text-sm">Sign in and tap "Resend email" to get a fresh verification link.</p>
          <Link to="/login" className="inline-block mt-6 rounded-full bg-[#1F3F5B] text-white px-6 py-2.5 text-sm font-bold">Sign in</Link>
        </div>
      )}
    </div>
  );
}
