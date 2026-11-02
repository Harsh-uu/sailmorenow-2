import "react-native-gesture-handler";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform, View } from "react-native";
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

// -------------------------------------------------------------------------
// App-wide CONTENT text ceiling (native only).
//
// GOAL: content Text/TextInput must never scale past 2x so extreme iOS
// accessibility sizes cannot blow up layouts, while chrome components keep their
// own tighter explicit caps (header 1.3, tab labels 1.1, chips/badges/buttons/
// segmented/legend 1.2).
//
// WHY THE EARLIER ATTEMPTS FAILED (verified against node_modules):
//   - `(Text).defaultProps = {...}` is ignored by React 19.
//   - The later render-wrapper patch assumed Text was a `forwardRef` object with
//     a `.render` field. In react-native 0.88 `Text`/`TextInput` are PLAIN
//     FUNCTION COMPONENTS (new RN "component" syntax, Libraries/Text/Text.js:
//     `const TextImpl: component(...) = (...) => {...}`), so they have no
//     `.render`; the patch hit `typeof orig !== "function"` and silently
//     no-opped on device.
//
// HOW THIS WORKS: react-native exports `Text`/`TextInput` as CONFIGURABLE getters
// on its module object (index.js: `get Text() { return require(...).default }`),
// and every consumer reads them lazily at render time (`_reactNative.Text`). We
// capture the originals, then redefine those getters to return thin wrapper
// components that inject maxFontSizeMultiplier=2 ONLY when the caller did not
// set it - so every explicit cap (inline, via StyleSheet, or passed down by a
// wrapper component) is preserved. This changes ONE module and needs no edits to
// the ~93 files that import Text/TextInput.
//
// TO REMOVE: delete installContentFontCap() and its call below.
function installContentFontCap() {
  if (Platform.OS === "web") return; // native-only prop; web preview can't emulate iOS text sizing
  const RN: any = require("react-native");
  for (const key of ["Text", "TextInput"] as const) {
    const desc = Object.getOwnPropertyDescriptor(RN, key);
    if (!desc || desc.configurable === false) continue;
    const Orig = RN[key];
    if (typeof Orig !== "function" || (Orig as any).__contentFontCapped) continue;
    const Capped = (props: any) =>
      props?.maxFontSizeMultiplier == null
        ? <Orig {...props} maxFontSizeMultiplier={2} />
        : <Orig {...props} />;
    (Capped as any).displayName = `Capped(${Orig.displayName || Orig.name || key})`;
    (Capped as any).__contentFontCapped = true;
    Object.defineProperty(RN, key, { configurable: true, enumerable: true, get: () => Capped });
  }
}

installContentFontCap();

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
