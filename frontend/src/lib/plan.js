import { toast } from "sonner";

// Single client-side source of truth for "may this account actively participate"
// (direct messages, group chat, Crew messages, posts, comments, reactions,
// reviews, events, Crew listings). Mirrors the backend deps.can_interact():
// any paid tier qualifies, and community_partner and founding_partner are always
// included. Free accounts may browse/read only. account_type rules (e.g. orgs are
// never in the Crew Bank) are enforced separately where they apply.
export function canInteract(user) {
  if (!user) return false;
  const tier = (user.subscription_tier || "free").toLowerCase();
  return tier !== "free";
}

// "Free individual" = not a paid subscriber AND not a partner org. Mirrors the
// server create gate (account_type != "partner" and not paid) and the mobile
// isFreeIndividual(): free partner orgs are NOT caught here (they keep the
// server's org limits); paid accounts, Boat Pros and admins (all paid) pass.
export function isFreeIndividual(user) {
  if (!user) return false;
  return !canInteract(user) && (user.account_type || "") !== "partner";
}

// Reuses the SAME upgrade prompt the paywall interceptor and MessageLink show:
// a toast with a "See plan details" action that routes to My plan (the caller is
// a logged-in free account). Used to front-load the prompt when a free account
// clicks to start creating.
export function promptUpgrade(message = "This is a Premium feature.") {
  toast.error(message, { action: { label: "See plan details", onClick: () => { window.location.href = "/my-plan"; } } });
}
