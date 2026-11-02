import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Modal from "@/components/Modal";
import { api, PRIVACY_URL } from "@/lib/api";
import { toast } from "sonner";

export default function DeleteAccountSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState(null);
  const [code, setCode] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const startCooldown = () => {
    setCooldown(60);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(timer.current); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const openFlow = async () => {
    setOpen(true); setStep(1); setCode(""); setConfirmText("");
    try {
      const { data } = await api.get("/account/delete/preview");
      setPreview(data);
    } catch { setPreview(null); }
  };

  const sendCode = async () => {
    setBusy(true);
    try {
      await api.post("/account/delete/send-code");
      toast.success("We emailed you a 6-digit code.");
      setStep(2);
      startCooldown();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send the code.");
    } finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.post("/account/delete/confirm", { code: code.trim(), confirm_text: confirmText });
      toast.success("Your account has been deleted.");
      setOpen(false);
      try { await logout(); } catch { /* ignore */ }
      navigate("/");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete your account.");
    } finally { setBusy(false); }
  };

  const ownsBusiness = preview && (preview.owns_listing || preview.is_org);

  return (
    <section className="mt-8 bg-white rounded-2xl p-8 border border-red-200" data-testid="delete-account-section">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-red-500">Danger zone</div>
      <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1">Delete account</h2>
      <p className="text-slate-600 text-sm mt-2 max-w-xl">
        This permanently removes your profile and personal data. It cannot be undone.
      </p>
      <button
        onClick={openFlow}
        data-testid="delete-account-open-btn"
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-2.5 transition-colors"
      >
        Delete account
      </button>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Delete account" testId="delete-account-modal">
        <div className="p-5 sm:p-6 max-w-lg">
          {step === 1 && (
            <div data-testid="delete-step-explain">
              <p className="text-sm text-slate-700 leading-relaxed">
                Deleting your account removes your profile, posts, comments, listings, reviews,
                messages and photos. We keep a small set of records we are legally required to
                retain, with your name and contact details removed.
              </p>
              {preview?.store_plan && (
                <p className="text-sm text-slate-700 leading-relaxed mt-3">
                  If you pay through the App Store or Google Play, cancel that subscription in the
                  store. On iPhone: Settings, your name, Subscriptions. On Android: Play Store,
                  Payments and subscriptions.
                </p>
              )}
              {preview?.has_active_plan && !preview?.store_plan && (
                <p className="text-sm text-slate-700 leading-relaxed mt-3">
                  Your paid plan will be cancelled immediately with no refund.
                </p>
              )}
              {ownsBusiness && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" data-testid="delete-business-warning">
                  <p className="text-sm text-red-700 leading-relaxed font-semibold">
                    You manage a business listing or organization. Deleting also removes:
                  </p>
                  <ul className="text-sm text-red-700 mt-1 list-disc pl-5">
                    <li>your listing in the directory</li>
                    <li>reviews written about you</li>
                    <li>your followers</li>
                    <li>your plan, cancelled immediately with no refund</li>
                  </ul>
                </div>
              )}
              <p className="text-sm text-slate-700 leading-relaxed mt-3">
                This cannot be undone. Read our{" "}
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-[#55B3AD] font-semibold hover:underline" data-testid="delete-privacy-link">Privacy Policy</a>.
              </p>
              <button
                onClick={sendCode}
                disabled={busy}
                data-testid="delete-send-code-btn"
                className="mt-5 w-full rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-sm px-5 py-3 transition-colors"
              >
                {busy ? "Sending..." : "Email me a code"}
              </button>
            </div>
          )}

          {step === 2 && (
            <div data-testid="delete-step-confirm">
              <p className="text-sm text-slate-700 leading-relaxed">
                We emailed a 6-digit code. Enter it below and type DELETE to confirm. The code
                expires in 15 minutes.
              </p>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mt-4">Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                data-testid="delete-code-input"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg tracking-[0.3em] font-mono focus:border-[#55B3AD] focus:outline-none"
              />
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mt-4">Type DELETE to confirm</label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                data-testid="delete-confirm-text-input"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-[#55B3AD] focus:outline-none"
              />
              <button
                onClick={confirmDelete}
                disabled={busy || code.length !== 6 || confirmText !== "DELETE"}
                data-testid="delete-confirm-btn"
                className="mt-5 w-full rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-sm px-5 py-3 transition-colors"
              >
                {busy ? "Deleting..." : "Delete my account"}
              </button>
              <button
                onClick={sendCode}
                disabled={busy || cooldown > 0}
                data-testid="delete-resend-btn"
                className="mt-3 w-full text-sm font-semibold text-slate-500 disabled:opacity-50 hover:text-slate-700"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
}
