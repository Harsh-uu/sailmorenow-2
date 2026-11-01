import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const canceled = params.get("status") === "canceled";
  const [status, setStatus] = useState({ payment_status: "pending", status: "open" });
  const [attempts, setAttempts] = useState(0);
  const [returnToApp, setReturnToApp] = useState(false);
  const { refresh, user } = useAuth();

  useEffect(() => {
    if (!sessionId || canceled) return;
    let stopped = false;
    const poll = async (n) => {
      if (stopped || n >= 8) return;
      try {
        const { data } = await api.get(`/payments/status/${sessionId}`);
        setStatus(data);
        setAttempts(n + 1);
        if (data.payment_status === "paid") { await refresh(); return; }
        if (data.status === "expired") return;
      } catch (e) {
        // A browser arriving here from the mobile checkout redirect has no web
        // session, so the (auth-gated) status endpoint returns 401. That's not
        // an error for this page — the mobile app confirms the payment via its
        // own poll — so show a neutral "return to the app" message.
        if (e?.response?.status === 401) { setReturnToApp(true); return; }
      }
      setTimeout(() => poll(n + 1), 2000);
    };
    poll(0);
    return () => { stopped = true; };
  }, [sessionId, canceled, refresh]);

  const paid = status.payment_status === "paid";
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center" data-testid="payment-success-page">
      {canceled ? (
        <>
          <Icon name="close" tone="current" className="mx-auto h-16 w-16 text-slate-400" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] dark:text-slate-100 mt-6" data-testid="payment-canceled">Payment canceled</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">No charge was made. You can pick a plan whenever you're ready.</p>
          <Link to="/pricing" data-testid="canceled-pricing-btn" className="inline-block mt-6 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold">Back to pricing</Link>
        </>
      ) : returnToApp ? (
        <>
          <Icon name="success" tone="current" className="mx-auto h-16 w-16 text-[#55B3AD]" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] dark:text-slate-100 mt-6" data-testid="payment-return-to-app">Payment received</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">You can return to the app to see your updated plan.</p>
        </>
      ) : paid ? (
        <>
          <Icon name="success" tone="current" className="mx-auto h-16 w-16 text-[#55B3AD]" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] mt-6">You're all set!</h1>
          <p className="text-slate-600 mt-2">Your subscription is active. More time on the water awaits.</p>
          {user?.account_type === "boat_pro" ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to="/boat-pro-listing" data-testid="success-setup-listing-btn" className="inline-block bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold">Set up your listing</Link>
              <Link to="/dashboard" data-testid="success-dashboard-btn" className="inline-block bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-6 py-3 font-semibold">Go to dashboard</Link>
            </div>
          ) : (
            <Link to="/dashboard" data-testid="success-dashboard-btn" className="inline-block mt-6 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-6 py-3 font-semibold">Go to dashboard</Link>
          )}
        </>
      ) : status.status === "expired" ? (
        <>
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B]">Session expired</h1>
          <Link to="/pricing" className="inline-block mt-6 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold">Try again</Link>
        </>
      ) : (
        <>
          <Icon name="spinner" tone="current" className="mx-auto h-16 w-16 text-[#55B3AD] animate-spin" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] mt-6">Confirming your payment…</h1>
          <p className="text-slate-500 mt-2">Attempt {attempts} of 8</p>
        </>
      )}
    </div>
  );
}
