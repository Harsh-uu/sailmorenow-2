import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Tracks the OS "Reduce Motion" accessibility setting and stays reactive to
 * changes. Screens use this to drop non-essential animation (e.g. modal
 * slide/fade transitions) for users sensitive to motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (mounted) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
