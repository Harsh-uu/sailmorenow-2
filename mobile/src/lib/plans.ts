// Single source of truth for plan prices + discounts used by BOTH the sign-up
// screen (register.tsx) and the membership screen (pricing.tsx). Screens must
// compute display prices from here, never type prices by hand.
//
// Rounding rule: all money is rounded to 2 decimals (cents) with JS toFixed(2)
// (round half away from zero), applied separately to the per-month price and
// the term total, exactly as the membership screen already did.

export const SAILOR_MONTHLY = 6.99;

// Brand Boat Pros icon (SMN_Icon_BoatPros) used as the Boat Pro logo placeholder.
export const ICON_BOAT_PROS =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/1jy6xdh9_SMN_Icon_BoatPros.png";

// Prices only. Feature/benefit lists live in the backend matrix (GET
// /api/plans/matrix via @/src/lib/planMatrix) so copy cannot drift from the rules.
export const BOAT_PRO_TIERS = [
  { tier: "basic", label: "Basic", price: 12.99 },
  { tier: "featured", label: "Featured", price: 19.99 },
  { tier: "premium", label: "Premium", price: 29.99 },
];

// Boat pro: 10% @6mo, 20% @12mo. Sailor/Owner: 10% @3mo, 15% @6mo, 20% @12mo.
export const discountFor = (m: number, aud: string) => (aud === "boat_pro"
  ? (({ 6: 0.1, 12: 0.2 } as Record<number, number>)[m] || 0)
  : (({ 3: 0.1, 6: 0.15, 12: 0.2 } as Record<number, number>)[m] || 0));

export const monthOptionsFor = (aud: string) => (aud === "boat_pro" ? [1, 6, 12] : [1, 3, 6, 12]);

export const baseMonthly = (aud: string, tier?: string) =>
  (aud === "boat_pro" ? (BOAT_PRO_TIERS.find((t) => t.tier === tier)?.price ?? 0) : SAILOR_MONTHLY);

export function planPricing(aud: string, tier: string | undefined, months: number) {
  const base = baseMonthly(aud, tier);
  const discount = discountFor(months, aud);
  const perMonth = +(base * (1 - discount)).toFixed(2);
  const total = +(base * months * (1 - discount)).toFixed(2);
  return { base, discount, perMonth, total };
}

export const intervalLabel = (months: number) =>
  (months === 6 ? "every 6 months" : months === 12 ? "every 12 months" : months === 3 ? "every 3 months" : "per month");
