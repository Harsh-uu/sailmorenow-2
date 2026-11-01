// ONE web source for the plan FEATURE matrix. Reads the authoritative matrix
// from the backend (GET /api/plans/matrix -> backend/plan_features.py). Pricing,
// My plan and every locked prompt render from here so copy can never drift from
// the enforcement rules. Prices still come from @/lib/plans (GET /payments/packages);
// both ultimately derive from backend SUBSCRIPTION_PACKAGES.
import { api } from "@/lib/api";

let _cache = null;
let _inflight = null;

export async function loadMatrix() {
  if (_cache) return _cache;
  if (!_inflight) {
    _inflight = api.get("/plans/matrix").then(({ data }) => {
      _cache = data;
      _inflight = null;
      return data;
    }).catch((e) => { _inflight = null; throw e; });
  }
  return _inflight;
}

// account_type -> matrix account-type key.
const TYPE_MAP = { sailor: "member", boat_owner: "member", crew: "member", boat_pro: "boat_pro", partner: "organization" };
export const accountTypeKey = (user) => TYPE_MAP[user?.account_type] || "member";

// A logged-in user manages their plan at /my-plan; logged-out visitors see /pricing.
export const planDest = (user) => (user ? "/my-plan" : "/pricing");

export const findType = (matrix, typeKey) =>
  (matrix?.account_types || []).find((a) => a.key === typeKey) || null;

export const findFeature = (matrix, typeKey, featureKey) => {
  const t = findType(matrix, typeKey);
  return t ? (t.features || []).find((f) => f.key === featureKey) || null : null;
};

// Render a raw matrix value as a short label.
export const valueLabel = (v) => {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v == null) return "-";
  return String(v);
};
export const isTruthy = (v) => !(v === false || v == null || v === 0 || v === "0" || v === "None" || v === "n/a");

// Benefit bullets for one level: feature labels whose value is "on" for that
// level (skips held rows). Used by the Pricing cards.
export function bulletsFor(matrix, typeKey, levelKey) {
  const t = findType(matrix, typeKey);
  if (!t) return [];
  return (t.features || [])
    .filter((f) => !f.hold && isTruthy(f.values?.[levelKey]))
    .map((f) => {
      const v = f.values[levelKey];
      return (v === true) ? f.label : `${f.label}: ${valueLabel(v)}`;
    });
}

// ALL features for a type in ONE fixed order (matrix order = single source of
// truth), each with its per-level values. Used to render the three tiers side by
// side so every row lines up, showing "Not included" where a tier lacks it.
export function featureRows(matrix, typeKey) {
  const t = findType(matrix, typeKey);
  if (!t) return [];
  return (t.features || [])
    .filter((f) => !f.hold)
    .map((f) => ({ key: f.key, label: f.label, values: f.values || {} }));
}

// Which level labels include a feature (for "included with ..." lines in prompts).
export function levelsWith(matrix, typeKey, featureKey) {
  const t = findType(matrix, typeKey);
  const f = findFeature(matrix, typeKey, featureKey);
  if (!t || !f) return [];
  return t.levels.filter((l) => isTruthy(f.values?.[l.key])).map((l) => l.label);
}

// Benefit bullets a paid level adds over a base (free) level: what you unlock by
// upgrading. Used by the Pricing Sailor/Owner card.
export function upgradeBulletsFor(matrix, typeKey, paidLevel, baseLevel) {
  const t = findType(matrix, typeKey);
  if (!t) return [];
  return (t.features || [])
    .filter((f) => !f.hold && isTruthy(f.values?.[paidLevel]) && !isTruthy(f.values?.[baseLevel]))
    .map((f) => {
      const v = f.values[paidLevel];
      return (v === true) ? f.label : `${f.label}: ${valueLabel(v)}`;
    });
}
