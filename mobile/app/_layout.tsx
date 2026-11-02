import "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Text as RNText, TextInput as RNTextInput, View } from "react-native";
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
// tighter caps (header 1.3, tab labels 1.1, chips/badges/buttons 1.2) which
// override this default; anything without an explicit cap inherits 1.5.
(RNText as any).defaultProps = { ...(RNText as any).defaultProps, maxFontSizeMultiplier: 1.5 };
(RNTextInput as any).defaultProps = { ...(RNTextInput as any).defaultProps, maxFontSizeMultiplier: 1.5 };

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
