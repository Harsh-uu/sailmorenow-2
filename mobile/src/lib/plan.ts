// Single client-side source of truth for "may this account actively participate"
// (direct messages, group chat, Crew messages, posts, comments, reactions,
// reviews, events, Crew listings). Mirrors the backend deps.can_interact():
// any paid tier qualifies, and community_partner and founding_partner are always
// included. Free accounts may browse/read only. account_type rules (e.g. orgs are
// never in the Crew Bank) are enforced separately where they apply.
export function canInteract(
  user?: { subscription_tier?: string | null } | null,
): boolean {
  if (!user) return false;
  const tier = (user.subscription_tier || "free").toLowerCase();
  return tier !== "free";
}

// "Free individual" = not a paid subscriber AND not a partner org. Mirrors the
// server gate on create (account_type != "partner" and not paid): free partner
// orgs are NOT blocked from opening forum/blog creation; they keep the server's
// existing org limits. Paid accounts, Boat Pros and admins (all paid) are
// unaffected.
export function isFreeIndividual(
  user?: { subscription_tier?: string | null; account_type?: string | null } | null,
): boolean {
  if (!user) return false;
  return !canInteract(user) && (user.account_type || "") !== "partner";
}

// "Can this account post events?" Alpha rule: only clubs/orgs (partner, incl.
// free partner orgs), Boat Pros and admins. Sailors and boat owners (paid or
// free) cannot yet. Mirrors the server gate on POST /events.
export function canPostEvents(
  user?: { account_type?: string | null; platform_role?: string | null } | null,
): boolean {
  if (!user) return false;
  if (user.platform_role === "admin") return true;
  const at = user.account_type || "";
  return at === "partner" || at === "boat_pro";
}

