// Design tokens for Sail More Now (mobile). Mirrors the web brand:
//   navy #1F3F5B, teal #55B3AD, sun/orange #F2A03B.
// Light theme only for now. Use makeStyles(colors => ...) in screens and
// useTheme().colors for non-style color props.

import { useMemo, useSyncExternalStore } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { storage } from "@/src/utils/storage";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FFFFFF",
  onSurface: "#0F2233",
  surfaceSecondary: "#F1F5F9", // slate-100 — cards / rows
  onSurfaceSecondary: "#334155",
  surfaceTertiary: "#E2E8F0", // inputs / chips
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#1F3F5B",
  onSurfaceInverse: "#FFFFFF",
  muted: "#64748B", // captions, timestamps, placeholders

  // Brand — navy anchor
  brand: "#1F3F5B",
  onBrand: "#FFFFFF",
  brandPrimary: "#1F3F5B", // active tab, headers, selected
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#55B3AD", // teal accents
  onBrandSecondary: "#06231F", // dark ink — white fails WCAG on #55B3AD (2.5:1)
  brandTertiary: "#E6F4F3", // soft teal chips
  onBrandTertiary: "#1F3F5B",

  // Named brand colors (use directly where semantics need it)
  navy: "#1F3F5B",
  teal: "#55B3AD",
  tealText: "#0E7A72", // darker teal for TEXT/labels — 5.2:1 on white, 4.7:1 on slate-100 (raw #55B3AD is only 2.5:1)
  tealSoft: "#E6F4F3",
  accent: "#F2A03B", // sun/orange — primary CTA
  onAccent: "#10233A", // dark ink for WCAG-AA contrast on orange
  accentSoft: "#FDF0DD",
  onAccentSoft: "#8A4B10", // readable amber ink on soft-orange chips (6.0:1)

  // Status
  success: "#15803D",
  onSuccess: "#FFFFFF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#B91C1C",
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  divider: "#E2E8F0",

  // Active bottom-tab tint (navy in light, teal in dark — always legible).
  tabActive: "#1F3F5B",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  // Surfaces
  surface: "#1B2740",           // cards, lifted off the app background
  onSurface: "#EEF3F9",         // primary text on cards  (~12.3:1)
  surfaceSecondary: "#0B1220",  // app background / rows behind cards
  onSurfaceSecondary: "#CBD7E6",// secondary text        (~9.0:1 on card)
  surfaceTertiary: "#2C3A52",   // inputs / chips
  onSurfaceTertiary: "#CBD7E6",
  surfaceInverse: "#EEF3F9",
  onSurfaceInverse: "#0B1220",
  muted: "#93A3BC",             // captions/timestamps    (~4.6:1 on card)

  // Brand
  brand: "#1F3F5B",
  onBrand: "#FFFFFF",
  brandPrimary: "#152A3D",      // screen headers / deep navy chrome
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#66C6BF",
  onBrandSecondary: "#06231F",
  brandTertiary: "#173A44",     // soft teal chip
  onBrandTertiary: "#CFF3EF",

  navy: "#1F3F5B",
  teal: "#66C6BF",              // lightened teal for icons/text on dark
  tealText: "#66C6BF",          // teal TEXT on dark surfaces — 7.4:1 on cards
  tealSoft: "#153038",
  accent: "#F2A03B",
  onAccent: "#10233A",
  accentSoft: "#3A2E1B",
  onAccentSoft: "#F2C078", // light amber on dark soft-orange chip (7.9:1)

  // Status (lightened so they read on dark surfaces)
  success: "#4ADE80",
  onSuccess: "#052E16",
  warning: "#FBBF24",
  onWarning: "#3A2E05",
  error: "#F87171",
  onError: "#3A0B0B",
  info: "#7DB4FF",
  onInfo: "#0B1A3A",

  // Lines
  border: "#2C3A52",
  borderStrong: "#45566F",
  divider: "#1B2740",

  tabActive: "#66C6BF",
};

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark: ThemeColors } = { light, dark };

// ---------------------------------------------------------------------------
// Theme preference store: "light" | "dark" | "system".
// A tiny external store (no Provider needed) so every useTheme() consumer stays
// reactive when the user changes their preference in Profile. Persisted so the
// choice survives app restarts.
// ---------------------------------------------------------------------------
export type ThemePref = "light" | "dark" | "system";
const PREF_KEY = "smn-theme-pref";

let _pref: ThemePref = "system";
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((cb) => cb());
}

export async function setThemePref(pref: ThemePref) {
  _pref = pref;
  _notify();
  try {
    await storage.secureSet(PREF_KEY, pref);
  } catch {
    /* non-fatal */
  }
}

export function getThemePref(): ThemePref {
  return _pref;
}

// Hydrate the persisted preference on startup.
storage
  .secureGet<ThemePref>(PREF_KEY, "system")
  .then((v) => {
    if (v === "light" || v === "dark" || v === "system") {
      _pref = v;
      _notify();
    }
  })
  .catch(() => {});

function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function useTheme(): {
  scheme: ColorScheme;
  colors: ThemeColors;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
} {
  const pref = useSyncExternalStore(_subscribe, getThemePref, getThemePref);
  const system = useColorScheme();
  const scheme: ColorScheme =
    pref === "system" ? (system && themes[system] ? system : defaultScheme) : pref;
  return { scheme, colors: themes[scheme] ?? themes.light, pref, setPref: setThemePref };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
