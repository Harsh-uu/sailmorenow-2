import React, { useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, Keyboard, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, useWindowDimensions, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/src/components/Screen";
import { useTheme } from "@/src/theme";

const KB_FIELD_EVT = "kbfield";
const FOOTER_RESERVE = 80;

/**
 * Attach to each input field (works regardless of tree position because it goes
 * through DeviceEventEmitter, not React context):
 *  - spread `onLayout` on the field's WRAPPER when the wrapper is a DIRECT child
 *    of the scroll content (records its content-space y). On DEEPLY NESTED fields
 *    (e.g. the Profile tab) the layout y is parent-relative, so OMIT onLayout and
 *    pass only `onFocus`; the body then measures the focused input in window
 *    coords (content-space correct at any depth).
 *  - spread `onFocus` on the TextInput (scrolls that field above the keyboard).
 */
export function useKbField(id: string) {
  return {
    onLayout: (e: any) => DeviceEventEmitter.emit(KB_FIELD_EVT, { type: "layout", id, y: e?.nativeEvent?.layout?.y ?? 0 }),
    onFocus: () => DeviceEventEmitter.emit(KB_FIELD_EVT, { type: "focus", id }),
  };
}

/**
 * Keyboard-safe scroll body (the measurement engine). Lives inside any Screen.
 * On focus (and again on keyboard-show and once the keyboard-open layout
 * settles) it scrollTo's the focused input's y so it sits just above the
 * keyboard; bottom padding = keyboard height + optional footer reserve so lower
 * inputs can reach the top. An optional pinned footer is lifted above the
 * keyboard. keyboardShouldPersistTaps="handled" dismisses the keyboard when the
 * user taps outside a field. This is the exact logic that KeyboardFormScreen
 * ships; it is also used standalone on the Profile tab (hero + modals) where a
 * full-screen form shell does not fit.
 */
export function KeyboardFormBody({
  children,
  footer,
  padded = true,
  contentBottom,
  contentContainerStyle,
  testID,
  onKeyboardChange,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
  contentBottom?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  onKeyboardChange?: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { height: winH } = useWindowDimensions();
  const [kb, setKb] = useState(0);
  const [viewH, setViewH] = useState(0);

  const onKbRef = useRef(onKeyboardChange);
  onKbRef.current = onKeyboardChange;

  // R3d-3g: how much space sits below this body's bottom edge (0 when the content
  // reaches the window bottom; the tab-bar height on screens inside the (tabs)
  // group). Measured from the scene's bottom edge vs the window bottom.
  const sceneRef = useRef<View>(null);
  const [spaceBelow, setSpaceBelow] = useState(0);
  // R3d-4a: round + ~2pt deadband so a near-equal value is a no-op, stopping the
  // onLayout -> setViewH -> effect -> re-render -> onLayout loop.
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const measureSpaceBelow = () => {
    (sceneRef.current as any)?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      const sb = Math.round(Math.max(0, winH - (y + h)));
      if (near(spaceBelow, sb)) return;
      if (!allowLayoutUpdate()) return;
      setSpaceBelow((prev) => (near(prev, sb) ? prev : sb));
    });
  };

  const scrollRef = useRef<ScrollView>(null);
  const scrollWrapRef = useRef<View>(null);
  const ys = useRef<Record<string, number>>({});
  const yFrom = useRef<Record<string, "layout" | "fallback">>({});
  const lastFocused = useRef<string | null>(null);

  const scrollYRef = useRef(0);
  const contentHRef = useRef(0);
  const viewHRef = useRef(0);
  const kbRef = useRef(0);
  const scrollCount = useRef(0);
  const clampedShort = useRef(false);
  const retried = useRef(false);

  const MAX_PER_FOCUS = 4;
  const userDraggingRef = useRef(false);
  const lastUserScrollAt = useRef(0);
  const userIsScrolling = () => userDraggingRef.current || Date.now() - lastUserScrollAt.current < 600;

  const layoutWindowStart = useRef(0);
  const layoutUpdates = useRef(0);
  const allowLayoutUpdate = () => {
    const now = Date.now();
    if (now - layoutWindowStart.current > 1000) { layoutWindowStart.current = now; layoutUpdates.current = 0; }
    layoutUpdates.current += 1;
    return layoutUpdates.current <= 20;
  };
  const resetBreaker = () => { layoutWindowStart.current = 0; layoutUpdates.current = 0; };

  const lift = Platform.OS === "ios" ? kb : 0;

  const maxScrollNow = () => Math.max(0, contentHRef.current - viewHRef.current);

  const applyScroll = (id: string) => {
    const y = ys.current[id];
    if (y == null) return;
    const desired = Math.max(0, y - 16);
    const max = maxScrollNow();
    const to = Math.min(desired, max);
    clampedShort.current = desired > max + 1;
    scrollCount.current += 1;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: to, animated: true }));
  };

  // Fallback (and PRIMARY path for deeply-nested fields that don't pass onLayout).
  // Measures the currently focused input and the ScrollView wrapper in window
  // coords, converts to a content-space y (+ current scroll offset), stores,
  // scrolls. measureInWindow on component refs is supported under Fabric.
  const measureFallback = (id: string) => {
    const input: any = (TextInput as any).State?.currentlyFocusedInput?.();
    const wrap: any = scrollWrapRef.current;
    if (!input?.measureInWindow || !wrap?.measureInWindow) return;
    wrap.measureInWindow((_sx: number, sTop: number) => {
      input.measureInWindow((_ix: number, iy: number, _iw: number, _ih: number) => {
        const contentY = (iy - sTop) + scrollYRef.current;
        if (Number.isFinite(contentY) && contentY >= 0) {
          ys.current[id] = contentY;
          yFrom.current[id] = "fallback";
          applyScroll(id);
        }
      });
    });
  };

  const scrollToId = (id: string | null) => {
    if (!id) return;
    if (userIsScrolling()) return;
    if (scrollCount.current >= MAX_PER_FOCUS) return;
    if (ys.current[id] == null || yFrom.current[id] === "fallback") { measureFallback(id); return; }
    if (!yFrom.current[id]) yFrom.current[id] = "layout";
    applyScroll(id);
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(KB_FIELD_EVT, (p: any) => {
      if (p?.type === "layout") {
        ys.current[p.id] = p.y;
        yFrom.current[p.id] = "layout";
      } else if (p?.type === "focus") {
        lastFocused.current = p.id;
        scrollCount.current = 0;
        clampedShort.current = false;
        retried.current = false;
        lastUserScrollAt.current = 0;
        resetBreaker();
        scrollToId(p.id);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, (e: any) => {
      const h = Math.round(e?.endCoordinates?.height ?? 0);
      if (near(kbRef.current, h)) return;
      kbRef.current = h;
      resetBreaker();
      setKb((prev) => (near(prev, h) ? prev : h));
      onKbRef.current?.(h);
      setTimeout(() => scrollToId(lastFocused.current), Platform.OS === "ios" ? 60 : 130);
    });
    const h = Keyboard.addListener(hideEvt, () => { if (kbRef.current === 0) return; kbRef.current = 0; resetBreaker(); setKb(0); onKbRef.current?.(0); });
    return () => { s.remove(); h.remove(); };
  }, []);

  const reserve = footer ? FOOTER_RESERVE : 0;
  const restBottom = contentBottom ?? (padded ? 20 : 0);

  return (
    <View ref={sceneRef} onLayout={measureSpaceBelow} style={{ flex: 1 }}>
      <View ref={scrollWrapRef} collapsable={false} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          onLayout={(e) => { const hh = Math.round(e.nativeEvent.layout.height); if (near(viewHRef.current, hh)) return; if (!allowLayoutUpdate()) return; viewHRef.current = hh; setViewH((prev) => (near(prev, hh) ? prev : hh)); }}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => { userDraggingRef.current = true; lastUserScrollAt.current = Date.now(); }}
          onScrollEndDrag={() => { userDraggingRef.current = false; lastUserScrollAt.current = Date.now(); }}
          onMomentumScrollBegin={() => { lastUserScrollAt.current = Date.now(); }}
          onMomentumScrollEnd={() => { lastUserScrollAt.current = Date.now(); }}
          onContentSizeChange={(_w, h) => {
            const grew = h > contentHRef.current + 1;
            contentHRef.current = h;
            if (grew && clampedShort.current && !retried.current && kbRef.current > 0 && lastFocused.current) {
              retried.current = true;
              scrollToId(lastFocused.current);
            }
          }}
          contentContainerStyle={[{ padding: padded ? 20 : 0 }, contentContainerStyle, { paddingBottom: restBottom + reserve + (kb > 0 ? viewH : 0) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
          testID={testID}
        >
          {children}
        </ScrollView>
      </View>
      {footer ? (
        <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, marginBottom: lift > 0 ? Math.max(0, lift - spaceBelow) : 0, paddingBottom: lift > 0 ? 12 : (spaceBelow > insets.bottom + 4 ? 12 : insets.bottom + 12) }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Full-SCREEN keyboard-safe form shell (NOT a Modal): Screen chrome (title, back,
 * a header "Done" button while the keyboard is open) wrapping a KeyboardFormBody.
 */
export function KeyboardFormScreen({
  title,
  children,
  footer,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [kb, setKb] = useState(0);

  return (
    <Screen
      title={title}
      showBack
      padded={false}
      right={
        kb > 0 ? (
          <Pressable testID="kb-done-btn" onPress={() => Keyboard.dismiss()} hitSlop={10} style={{ paddingHorizontal: 6, paddingVertical: 6 }}>
            <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 }}>Done</Text>
          </Pressable>
        ) : null
      }
    >
      <KeyboardFormBody footer={footer} testID={testID} onKeyboardChange={setKb}>
        {children}
      </KeyboardFormBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
