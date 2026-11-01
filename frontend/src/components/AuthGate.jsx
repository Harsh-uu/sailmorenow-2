import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";

/**
 * Full-page gate shown to logged-out visitors on member-only pages. Explains
 * why an account is needed and offers clear sign-up / log-in CTAs that return
 * the visitor to the page they originally tried to open after they auth.
 */
export function AuthGate({ feature = "use this feature", title }) {
  const nav = useNavigate();
  const location = useLocation();
  const next = location.pathname + location.search;

  const go = (mode) => {
    try { sessionStorage.setItem("smn_post_auth", next); } catch {}
    nav(`/${mode}?next=${encodeURIComponent(next)}`);
  };

  return (
    <div data-testid="auth-gate" className="min-h-[72vh] flex items-center justify-center px-4 py-16 bg-[var(--smn-bg)] dark:bg-slate-950">
      <div className="max-w-md w-full text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 sm:p-10 shadow-sm">
        <div className="inline-flex h-14 w-14 rounded-2xl bg-[#55B3AD]/15 items-center justify-center mb-5">
          <Icon name="lock" tone="current" className="h-7 w-7 text-[#55B3AD]" />
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl smn-heading">{title || "Create an account"}</h1>
        <p className="mt-3 text-slate-500 dark:text-slate-400 leading-relaxed">
          Join the Sail More Now community to unlock the full experience. Free to browse. Pay to engage.
        </p>
        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => go("register")} data-testid="gate-signup-btn"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white font-semibold px-6 py-3 transition-colors">
            <Icon name="user-plus" tone="current" className="h-4 w-4" /> Create an account
          </button>
          <button onClick={() => go("login")} data-testid="gate-login-btn"
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 dark:border-slate-600 text-[#1F3F5B] dark:text-slate-100 font-semibold px-6 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}

/** Route wrapper: renders the gate for logged-out visitors, else the page. */
export function RequireAuth({ feature, title, children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <AuthGate feature={feature} title={title} />;
  return children;
}

export default RequireAuth;
