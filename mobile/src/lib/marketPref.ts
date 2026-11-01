import { useSyncExternalStore } from "react";
import { storage } from "@/src/utils/storage";

// Remembered market selection, shared across Hub / Events / Crew Bank and
// persisted so it survives restarts. Value is "all" | "mine" | a market name.
export type MarketPref = string;
const KEY = "smn-market-pref";

let _v: MarketPref = "mine";
const _ls = new Set<() => void>();

export function getMarketPref(): MarketPref {
  return _v;
}
export function setMarketPref(v: MarketPref) {
  _v = v;
  _ls.forEach((f) => f());
  storage.secureSet(KEY, v).catch(() => {});
}
storage
  .secureGet<MarketPref>(KEY, "mine")
  .then((v) => { if (v) { _v = v; _ls.forEach((f) => f()); } })
  .catch(() => {});

export function useMarketPref(): MarketPref {
  return useSyncExternalStore((cb) => { _ls.add(cb); return () => _ls.delete(cb); }, getMarketPref, getMarketPref);
}

function followed(user: any): string[] {
  if (user?.markets?.length) return user.markets;
  return user?.primary_market ? [user.primary_market] : [];
}

// Query-string fragment for the list endpoints (no leading ? or &).
export function marketParam(pref: MarketPref, user: any): string {
  if (pref === "all") return "";
  if (pref === "mine") {
    const ms = followed(user);
    return ms.length ? `markets=${encodeURIComponent(ms.join(","))}` : "";
  }
  return `market=${encodeURIComponent(pref)}`;
}

export function marketLabel(pref: MarketPref): string {
  return pref === "all" ? "All markets" : pref === "mine" ? "My markets" : pref;
}
