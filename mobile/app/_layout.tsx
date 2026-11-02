import "react-native-gesture-handler";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform, Text as RNText, TextInput as RNTextInput, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/context/AuthContext";
import { WebSocketProvider } from "@/src/context/WebSocketContext";
import { ToastProvider } from "@/src/context/ToastContext";
import { ProfilePreviewProvider } from "@/src/context/ProfilePreviewContext";
import { NotificationsProvider } from "@/src/context/NotificationsContext";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);

// App-wide CONTENT ceiling: content text/inputs never scale past 1.5x so extreme
// iOS accessibility sizes cannot break layouts. Chrome components set their own
// tighter caps (header 1.3, tab labels 1.1, chips/badges/buttons/segmented 1.2)
// which are always preserved; anything without an explicit cap inherits 1.5.
//
// HOW IT WORKS: React 19 ignores `defaultProps` on forwardRef host components
// (Text/TextInput), so the old defaultProps approach silently did nothing and
// any text without an explicit cap scaled unbounded. Instead we wrap each
// component's internal `render` and inject maxFontSizeMultiplier=1.5 ONLY when
// the element has none set (we check both the prop and a style-based value), so
// an explicit cap - inline, via StyleSheet, or passed down by a wrapper
// component - is never overridden. TO REMOVE: delete the two applyFontCap()
// calls below and the applyFontCap/hasExplicitCap helpers.
function hasExplicitCap(props: any): boolean {
  if (props == null) return false;
  if (props.maxFontSizeMultiplier != null) return true;
  const s = props.style;
  if (Array.isArray(s)) return s.some((x) => x && x.maxFontSizeMultiplier != null);
  return !!(s && typeof s === "object" && (s as any).maxFontSizeMultiplier != null);
}

function applyFontCap(Component: any) {
  if (!Component || Component.__fontCapPatched) return;
  const orig = Component.render;
  if (typeof orig !== "function") return;
  Component.render = function (...args: any[]) {
    const el = orig.apply(this, args);
    if (el && el.props && !hasExplicitCap(el.props)) {
      return React.cloneElement(el, { maxFontSizeMultiplier: 1.5 });
    }
    return el;
  };
  Component.__fontCapPatched = true;
}

// NOTE: native only. maxFontSizeMultiplier is a native-only prop; injecting it
// on react-native-web would leak an unknown prop onto DOM nodes. The web
// preview cannot emulate iOS large text anyway, so scoping to native keeps web
// unchanged while giving iOS the real 1.5x content ceiling.
if (Platform.OS !== "web") {
  applyFontCap(RNText);
  applyFontCap(RNTextInput);
}

function ThemedStack() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.brandPrimary }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfaceSecondary } }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <WebSocketProvider>
                <ToastProvider>
                  <ProfilePreviewProvider>
                    <NotificationsProvider>
                      <ThemedStack />
                    </NotificationsProvider>
                  </ProfilePreviewProvider>
                </ToastProvider>
              </WebSocketProvider>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
