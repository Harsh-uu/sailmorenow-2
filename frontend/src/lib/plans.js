// ONE web source for plan pricing. Reads the authoritative package list from the
// backend (GET /api/payments/packages), which mirrors backend/constants.py
// SUBSCRIPTION_PACKAGES. Never hardcode prices, discounts or term math in the
// pages; derive everything from here. Only non-price copy (feature lists,
// labels) stays in the pages.
import { api } from "@/lib/api";

let _cache = null;
let _inflight = null;

export async function loadPackages() {
  if (_cache) return _cache;
  if (!_inflight) {
    _inflight = api.get("/payments/packages").then(({ data }) => {
      _cache = data;
      _inflight = null;
      return data;
    }).catch((e) => {
      _inflight = null;
      throw e;
    });
  }
  return _inflight;
}

// account_type -> the pricing audience used by the package list.
export const audienceForAccountType = (t) =>
  ({ sailor: "sailor", boat_owner: "boat_owner", boat_pro: "boat_pro" }[t] || "sailor");

// Term options we expose per audience (Boat Pro has no 3 month term).
export const termOptionsFor = (audience) => (audience === "boat_pro" ? [1, 6, 12] : [1, 3, 6, 12]);

// The package id the backend expects for an audience + tier + term.
export const packageIdFor = (audience, tier, months) =>
  (audience === "boat_pro" ? `pro_${tier}_${months}`
    : audience === "boat_owner" ? `owner_premium_${months}`
      : `sailor_premium_${months}`);

export const intervalLabel = (months) =>
  (months === 6 ? "every 6 months" : months === 12 ? "every 12 months" : months === 3 ? "every 3 months" : "per month");

// Find one package row and derive display numbers. Sailor/Owner always use the
// single "premium" tier; Boat Pro uses the chosen tier.
export function pricing(packages, audience, tier, months) {
  const row = (packages || []).find(
    (p) => p.audience === audience && p.months === months
      && (audience === "boat_pro" ? p.tier === tier : p.tier === "premium"),
  );
  if (!row) return null;
  const perMonth = +(row.monthly * (1 - row.discount)).toFixed(2);
  return {
    packageId: row.package_id, monthly: row.monthly, months,
    perMonth, total: row.total, pct: Math.round(row.discount * 100), discount: row.discount,
  };
}
