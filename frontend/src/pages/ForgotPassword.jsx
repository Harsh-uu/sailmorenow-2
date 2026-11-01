import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, LOGO_COLOR, LOGO_WHITE } from "@/lib/api";
import { Icon } from "@/components/Icon";

const inputCls =
  "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#55B3AD]";

const GENERIC = "If an account exists for that email, we sent a reset link. Check your inbox and spam folder.";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError("Enter your email address.");
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errMsg(err) || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12" data-testid="forgot-password-page">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src={LOGO_COLOR} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain block dark:hidden" />
          <img src={LOGO_WHITE} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain hidden dark:block" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          {sent ? (
            <div className="text-center" data-testid="forgot-password-sent">
              <div className="h-12 w-12 rounded-2xl bg-[#55B3AD]/15 flex items-center justify-center mx-auto mb-4">
                <Icon name="mail" tone="brand" className="h-6 w-6" />
              </div>
              <h1 className="font-display font-extrabold text-xl text-[#1F3F5B] dark:text-slate-100">Check your email</h1>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{GENERIC}</p>
              <Link to="/login" data-testid="forgot-back-to-login" className="mt-6 inline-flex items-center gap-2 bg-[#1F3F5B] dark:bg-[#F2A03B] text-white rounded-full px-6 py-3 text-sm font-semibold">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="forgot-password-form">
              <div className="text-center">
                <h1 className="font-display font-extrabold text-xl text-[#1F3F5B] dark:text-slate-100">Forgot your password?</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Enter your email and we will send a link to reset it.</p>
              </div>
              <input
                className={inputCls}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                data-testid="forgot-email-input"
                autoComplete="email"
              />
              {error && <p data-testid="forgot-error" className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                data-testid="forgot-submit-btn"
                className="w-full bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60"
              >
                {busy ? "Sending..." : "Send reset link"}
              </button>
              <div className="text-center">
                <Link to="/login" className="text-xs font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline">Back to sign in</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
