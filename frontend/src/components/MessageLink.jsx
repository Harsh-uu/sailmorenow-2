import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { canInteract } from "@/lib/plan";
import { toast } from "sonner";

// Message link that respects the Premium paywall. Paid members go straight to
// the DM; free/signed-out members get an "Upgrade to message" prompt instead.
export default function MessageLink({ toUserId, className, children, testId, ariaLabel, title }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const isPaid = canInteract(user);
  if (isPaid) {
    return (
      <Link to={`/messages?to=${toUserId}`} data-testid={testId} aria-label={ariaLabel} title={title} className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    );
  }
  const handle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) { toast.error("Sign in to message"); nav("/login"); return; }
    toast.error("Direct messaging is a Premium feature.", { action: { label: "See plan details", onClick: () => nav("/my-plan") } });
  };
  return (
    <button type="button" onClick={handle} data-testid={testId} aria-label={ariaLabel} title={title} className={className}>
      {children}
    </button>
  );
}
