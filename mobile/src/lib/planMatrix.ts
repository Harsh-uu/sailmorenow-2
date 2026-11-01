// Mobile source for the plan FEATURE matrix. Fetches the SAME backend matrix as
// web (GET /api/plans/matrix) so Pricing and My plan copy cannot drift from the
// enforcement rules. Prices still come from @/src/lib/plans (sign-up calculator),
// which mirrors backend SUBSCRIPTION_PACKAGES.
import { api } from "@/src/lib/api";

export type MatrixFeature = {
  key: string; label: string; meaning?: string; short?: string;
  values: Record<string, boolean | number | string>; source?: string; promised?: boolean; hold?: boolean;
};
export type MatrixType = { key: string; label: string; levels: { key: string; label: string }[]; features: MatrixFeature[] };
export type Matrix = { generated_at: string; pricing: any; account_types: MatrixType[] };

let _cache: Matrix | null = null;
let _inflight: Promise<Matrix> | null = null;

export async function loadMatrix(): Promise<Matrix> {
  if (_cache) return _cache;
  if (!_inflight) {
    _inflight = api.get<Matrix>("/plans/matrix").then((data) => { _cache = data; _inflight = null; return data; })
      .catch((e) => { _inflight = null; throw e; });
  }
  return _inflight;
}

const TYPE_MAP: Record<string, string> = { sailor: "member", boat_owner: "member", crew: "member", boat_pro: "boat_pro", partner: "organization" };
export const accountTypeKey = (accountType?: string) => TYPE_MAP[accountType || ""] || "member";

export const findType = (m: Matrix | null, key: string) => (m?.account_types || []).find((a) => a.key === key) || null;

export const isTruthy = (v: any) => !(v === false || v == null || v === 0 || v === "0" || v === "None" || v === "n/a");

export const valueLabel = (v: any) => (v === true ? "Yes" : v === false ? "No" : v == null ? "-" : String(v));

export function bulletsFor(m: Matrix | null, typeKey: string, levelKey: string): string[] {
  const t = findType(m, typeKey);
  if (!t) return [];
  return t.features.filter((f) => !f.hold && isTruthy(f.values?.[levelKey]))
    .map((f) => (f.values[levelKey] === true ? f.label : `${f.label}: ${valueLabel(f.values[levelKey])}`));
}

export function upgradeBulletsFor(m: Matrix | null, typeKey: string, paid: string, base: string): string[] {
  const t = findType(m, typeKey);
  if (!t) return [];
  return t.features.filter((f) => !f.hold && isTruthy(f.values?.[paid]) && !isTruthy(f.values?.[base]))
    .map((f) => (f.values[paid] === true ? f.label : `${f.label}: ${valueLabel(f.values[paid])}`));
}

// ALL features in ONE fixed order (matrix order = single source of truth), each
// with per-level values, so tiers line up row-by-row with "Not included" shown.
export function featureRows(m: Matrix | null, typeKey: string): { key: string; label: string; values: any }[] {
  const t = findType(m, typeKey);
  if (!t) return [];
  return t.features.filter((f) => !f.hold).map((f) => ({ key: f.key, label: f.label, values: f.values || {} }));
}
