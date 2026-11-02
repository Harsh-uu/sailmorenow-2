import React, { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Keyboard, PixelRatio, Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStackBase } from "@/src/lib/stackBase";
import { BUILD_ID } from "@/src/lib/buildStamp";

/**
 * MOBILE-KB-2/3 on-screen debug strip. Set to false to hide it everywhere.
 * (Must be false before shipping to users.)
 */
export const KB_DEBUG = true;

/** Animated bottom padding for the pinned bar; provided by BottomBarKeyboardView. */
export const BottomBarPaddingContext = React.createContext<Animated.Value | null>(null);

type Dbg = { kbHeight: number; kbTop: number; winH: number; barBottom: number; lift: number; pad: number };

/**
 * Shared wrapper for every screen with a pinned bottom input bar.
 *
 * MEASUREMENT-BASED (no offset/guess): it caches the bar's CLOSED-keyboard bottom
 * edge in window coords (measureInWindow on layout while closed), reads the
 * keyboard top Y from the keyboard event, and lifts the whole bar via an animated
 * marginBottom by exactly max(0, closedBottom - keyboardTop) so the bar's bottom
 * edge lands flush on the keyboard - identical on every screen regardless of nesting.
 *
 * MOBILE-KB-3: the bar's bottom padding is also owned here and animated IN PARALLEL
 * with the lift. At rest it is the resting inset (inside a tab: 10; outside a tab:
 * insets.bottom + 10 so the bar clears the home indicator). When the keyboard opens
 * it drops to 10 on every screen, so the INPUT sits ~10 above the keyboard (same as
 * in-tab screens) instead of being pushed up by the home-indicator inset. Because the
 * lift is derived from the cached closed geometry (not a re-measured value that
 * already includes the lift or the shrunken padding), the bar's bottom edge stays
 * flush while the padding animates. Bars read this value via useBottomBarPadding().
 * (react-native-keyboard-controller is intentionally NOT used: absent from Expo Go.)
 */
export function BottomBarKeyboardView({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const inTab = useStackBase() !== "";
  const restingPad = (inTab ? 0 : insets.bottom) + 10;
  const openPad = 10;

  const lift = useRef(new Animated.Value(0)).current;
  const pad = useRef(new Animated.Value(restingPad)).current;
  const liftVal = useRef(0);
  const containerRef = useRef<any>(null);
  const closedBottom = useRef(0);
  const closedWinH = useRef(0);
  const kbOpen = useRef(false);
  const [dbg, setDbg] = useState<Dbg>({ kbHeight: 0, kbTop: 0, winH: 0, barBottom: 0, lift: 0, pad: restingPad });

  useEffect(() => {
    const id = lift.addListener(({ value }) => { liftVal.current = value; });
    return () => lift.removeListener(id);
  }, [lift]);

  // Keep resting padding in sync if the safe-area inset changes while closed.
  useEffect(() => { if (!kbOpen.current) pad.setValue(restingPad); }, [restingPad, pad]);

  // Cache the bar's CLOSED bottom edge (window coords) whenever layout settles
  // while the keyboard is down. Add back any residual lift just in case.
  const cacheClosed = () => {
    const node = containerRef.current;
    if (!node) return;
    node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      closedBottom.current = y + h + liftVal.current;
      closedWinH.current = Dimensions.get("window").height;
    });
  };
  const onLayout = () => { if (!kbOpen.current) cacheClosed(); };

  useEffect(() => {
    const animate = (toLift: number, toPad: number, duration: number) => {
      const d = Math.max(1, duration);
      Animated.parallel([
        Animated.timing(lift, { toValue: toLift, duration: d, useNativeDriver: false }),
        Animated.timing(pad, { toValue: toPad, duration: d, useNativeDriver: false }),
      ]).start();
    };

    const toClosed = (duration: number) => {
      kbOpen.current = false;
      animate(0, restingPad, duration);
      if (KB_DEBUG) setDbg((prev) => ({ ...prev, kbHeight: 0, kbTop: 0, lift: 0, pad: restingPad }));
    };

    const onFrame = (e: any) => {
      const winH = Dimensions.get("window").height;
      const kbTop = e?.endCoordinates?.screenY ?? winH;
      const kbHeight = Math.max(0, winH - kbTop);
      const duration = e?.duration ?? 250;
      if (kbHeight <= 1) { toClosed(duration); return; } // a WillChangeFrame that is really a hide

      const finish = () => {
        const l = Math.max(0, closedBottom.current - kbTop);
        kbOpen.current = true;
        animate(l, openPad, duration);
        if (KB_DEBUG) setDbg({ kbHeight, kbTop, winH, barBottom: closedBottom.current, lift: l, pad: openPad });
      };
      // (Re)cache closed geometry on first open or after a rotation (winH change).
      if (!closedBottom.current || closedWinH.current !== winH) {
        const node = containerRef.current;
        if (node) node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          closedBottom.current = y + h + liftVal.current;
          closedWinH.current = winH;
          finish();
        });
        else finish();
      } else finish();
    };

    const showEvt = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, onFrame);
    const h = Keyboard.addListener(hideEvt, (e: any) => toClosed(e?.duration ?? 200));
    return () => { s.remove(); h.remove(); };
  }, [lift, pad, restingPad]);

  return (
    <BottomBarPaddingContext.Provider value={pad}>
      <Animated.View ref={containerRef as any} collapsable={false} onLayout={onLayout} style={[{ flex: 1, marginBottom: lift }, style]}>
        {KB_DEBUG ? <KbDebugStrip dbg={dbg} inTab={inTab} insetBottom={insets.bottom} /> : null}
        {children}
      </Animated.View>
    </BottomBarPaddingContext.Provider>
  );
}

function KbDebugStrip({ dbg, inTab, insetBottom }: { dbg: Dbg; inTab: boolean; insetBottom: number }) {
  return (
    <View testID="kb-debug-strip" style={styles.debug}>
      <Text style={styles.debugText}>
        KB h={Math.round(dbg.kbHeight)} top={Math.round(dbg.kbTop)} · win={Math.round(dbg.winH)} · barBtm={Math.round(dbg.barBottom)} · LIFT={Math.round(dbg.lift)} · PAD={Math.round(dbg.pad)} · inset={Math.round(insetBottom)} · tab={inTab ? "Y" : "N"} · b={BUILD_ID}
      </Text>
      <FontCapProbe />
    </View>
  );
}

// TEMP on-device probe for the 2x content-text cap (remove with KB_DEBUG at
// launch). Measures the rendered height of an UNCAPPED Text against a reference
// Text pinned at 1.0x; their ratio is the effective multiplier the OS applied.
// With the cap working, that ratio never exceeds ~2.0 even when the iOS font
// scale is higher. Shows e.g. "fs=3.57 probe=2.00 OK".
const PROBE_BASE = 12;
const PROBE_CAP = 2;
function FontCapProbe() {
  const fontScale = PixelRatio.getFontScale();
  const [refH, setRefH] = useState(0);
  const [probeH, setProbeH] = useState(0);
  const ratio = refH > 0 && probeH > 0 ? probeH / refH : 0;
  const expectedCapped = Math.min(fontScale, PROBE_CAP);
  const ok = ratio > 0 ? Math.abs(ratio - expectedCapped) <= 0.15 : null;
  return (
    <View>
      <Text style={styles.debugText}>
        fontcap fs={fontScale.toFixed(2)} probe={ratio ? ratio.toFixed(2) : "-"} cap={PROBE_CAP} {ok == null ? "" : ok ? "OK" : "FAIL"}
      </Text>
      <View style={styles.probeHidden} pointerEvents="none">
        {/* reference: explicit 1.0x cap -> never scales -> baseline height */}
        <Text maxFontSizeMultiplier={1} style={{ fontSize: PROBE_BASE }} onLayout={(e) => setRefH(e.nativeEvent.layout.height)}>Mg</Text>
        {/* probe: no explicit cap -> subject to the global 2x ceiling */}
        <Text style={{ fontSize: PROBE_BASE }} onLayout={(e) => setProbeH(e.nativeEvent.layout.height)}>Mg</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  debug: { backgroundColor: "#111827", paddingHorizontal: 8, paddingVertical: 4, zIndex: 50 },
  debugText: { color: "#4ADE80", fontSize: 10, fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  probeHidden: { position: "absolute", left: -9999, top: 0, opacity: 0 },
});
