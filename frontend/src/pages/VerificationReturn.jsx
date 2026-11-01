import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function VerificationReturn() {
  const { refresh } = useAuth();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let stopped = false;
    const poll = async (n) => {
      if (stopped || n >= 6) return;
      try {
        const { data } = await api.get("/identity/status");
        setStatus(data.verified ? "verified" : data.status || "submitted");
        if (data.verified) { await refresh(); return; }
      } catch { /* ignore */ }
      setTimeout(() => poll(n + 1), 2500);
    };
    poll(0);
    return () => { stopped = true; };
  }, [refresh]);

  const verified = status === "verified";
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center" data-testid="verify-return-page">
      {verified ? (
        <>
          <Icon name="verified" tone="current" className="mx-auto h-16 w-16 text-[#55B3AD]" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] dark:text-slate-100 mt-6">You're verified!</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">Your ID Verified badge is now active on your profile.</p>
        </>
      ) : (
        <>
          <Icon name="success" tone="current" className="mx-auto h-16 w-16 text-[#55B3AD]" />
          <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] dark:text-slate-100 mt-6" data-testid="verify-return-pending">Verification submitted</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">Thanks! Your documents are pending review. Your badge will appear once Stripe finishes checking, usually within a few minutes.</p>
        </>
      )}
      <Link to="/profile" data-testid="verify-return-profile-btn" className="inline-block mt-6 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-6 py-3 font-semibold">Back to profile</Link>
    </div>
  );
}
