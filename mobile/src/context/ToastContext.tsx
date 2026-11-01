import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconName } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";
import { useReducedMotion } from "@/src/hooks/useReducedMotion";

type ToastType = "success" | "error" | "info" | "warning";
type ToastState = { id: number; type: ToastType; message: string } | null;

type ToastApi = {
  show: (type: ToastType, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  warning: (m: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}

const NAME: Record<ToastType, IconName> = {
  success: "success",
  error: "error",
  info: "info",
  warning: "warning",
};

/**
 * Lightweight app-wide toast. Uses the unified <Icon> status set so mobile
 * status feedback matches the web. Respects the OS reduce-motion setting.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [toast, setToast] = useState<ToastState>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: reduce ? 0 : 180, useNativeDriver: true }).start(
      () => setToast(null),
    );
  }, [anim, reduce]);

  const show = useCallback(
    (type: ToastType, message: string) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), type, message });
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: reduce ? 0 : 220, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, 3200);
    },
    [anim, hide, reduce],
  );

  const api: ToastApi = {
    show,
    success: (m) => show("success", m),
    error: (m) => show("error", m),
    info: (m) => show("info", m),
    warning: (m) => show("warning", m),
  };

  const tint: Record<ToastType, string> = {
    success: colors.teal,
    error: colors.error,
    info: colors.onSurface,
    warning: colors.accent,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
          ]}
        >
          <Pressable
            onPress={hide}
            testID={`toast-${toast.type}`}
            style={[styles.toast, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Icon name={NAME[toast.type]} size={20} color={tint[toast.type]} footprint={24} label={toast.type} />
            <Text style={[styles.msg, { color: colors.onSurface }]} numberOfLines={3}>
              {toast.message}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 9999 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  msg: { flex: 1, fontWeight: "600", fontSize: 14 },
});
