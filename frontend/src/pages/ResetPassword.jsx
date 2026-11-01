import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg, LOGO_COLOR, LOGO_WHITE } from "@/lib/api";
import { Icon } from "@/components/Icon";

const inputCls =
  "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#55B3AD]";

const PW_RULES = [
  { key: "len", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "num", label: "One number", test: (p) => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
];
const pwStrong = (p) => PW_RULES.every((r) => r.test(p));

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [badLink, setBadLink] = useState(!token);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!pwStrong(pw)) return setError("Please choose a stronger password (see the checklist).");
    if (pw !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      setDone(true);
    } catch (err) {
      const msg = errMsg(err) || "Something went wrong. Please try again.";
      if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("expired")) {
        setBadLink(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12" data-testid="reset-password-page">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src={LOGO_COLOR} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain block dark:hidden" />
          <img src={LOGO_WHITE} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain hidden dark:block" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          {badLink ? (
            <div className="text-center" data-testid="reset-bad-link">
              <div className="h-12 w-12 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                <Icon name="error" tone="current" className="h-6 w-6 text-red-500" />
              </div>
              <h1 className="font-display font-extrabold text-xl text-[#1F3F5B] dark:text-slate-100">Link not valid</h1>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">This reset link is invalid or has expired. Request a new one.</p>
              <Link to="/forgot-password" data-testid="reset-request-new" className="mt-6 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 text-sm font-semibold">
                Request a new link
              </Link>
            </div>
          ) : done ? (
            <div className="text-center" data-testid="reset-success">
              <div className="h-12 w-12 rounded-2xl bg-[#55B3AD]/15 flex items-center justify-center mx-auto mb-4">
                <Icon name="success" tone="brand" className="h-6 w-6" />
              </div>
              <h1 className="font-display font-extrabold text-xl text-[#1F3F5B] dark:text-slate-100">Password updated</h1>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Your password has been reset. You can sign in now.</p>
              <Link to="/login" data-testid="reset-sign-in-btn" className="mt-6 inline-flex items-center gap-2 bg-[#1F3F5B] dark:bg-[#F2A03B] text-white rounded-full px-6 py-3 text-sm font-semibold">
                Sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="reset-password-form">
              <div className="text-center">
                <h1 className="font-display font-extrabold text-xl text-[#1F3F5B] dark:text-slate-100">Choose a new password</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Pick a strong password you do not use anywhere else.</p>
              </div>
              <div className="relative">
                <input
                  className={inputCls + " pr-10"}
                  type={show ? "text" : "password"}
                  placeholder="New password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); if (error) setError(null); }}
                  data-testid="reset-password-input"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" tabIndex={-1}>
                  {show ? <Icon name="visibilityOff" tone="current" className="h-4 w-4" /> : <Icon name="visibility" tone="current" className="h-4 w-4" />}
                </button>
              </div>
              <ul className="grid grid-cols-2 gap-1" data-testid="reset-pw-checklist">
                {PW_RULES.map((r) => {
                  const ok = r.test(pw);
                  return (
                    <li key={r.key} className={`flex items-center gap-1.5 text-xs ${ok ? "text-[#2A7871] dark:text-[#7fcac4]" : "text-slate-400"}`}>
                      <Icon name={ok ? "success" : "circle"} tone="current" className="h-3.5 w-3.5 shrink-0" /> {r.label}
                    </li>
                  );
                })}
              </ul>
              <input
                className={inputCls}
                type={show ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); if (error) setError(null); }}
                data-testid="reset-confirm-input"
                autoComplete="new-password"
              />
              {error && <p data-testid="reset-error" className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                data-testid="reset-submit-btn"
                className="w-full bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60"
              >
                {busy ? "Saving..." : "Reset password"}
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
