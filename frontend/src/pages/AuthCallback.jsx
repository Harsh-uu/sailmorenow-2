import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { LOGO_MARK } from "@/lib/api";

// One-time OAuth callback handler.
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    const session_id = m ? decodeURIComponent(m[1]) : null;
    if (!session_id) { navigate("/"); return; }
    (async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id });
        window.history.replaceState({}, "", "/dashboard");
        await refresh();
        let next = null;
        try { next = sessionStorage.getItem("smn_post_auth"); sessionStorage.removeItem("smn_post_auth"); } catch {}
        if (!data.user?.onboarding_complete) navigate("/onboarding", { replace: true });
        else if (next && next.startsWith("/")) navigate(next, { replace: true });
        else navigate("/dashboard", { replace: true });
      } catch (e) {
        navigate("/");
      }
    })();
  }, [navigate, refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white" data-testid="auth-callback">
      <div className="flex flex-col items-center gap-4">
        <img src={LOGO_MARK} alt="Sail More Now" className="h-16 w-16 animate-pulse" />
        <p className="text-slate-500 font-medium">Signing you in…</p>
      </div>
    </div>
  );
}
