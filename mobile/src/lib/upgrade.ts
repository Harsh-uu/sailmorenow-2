import { router } from "expo-router";
import { ApiError } from "@/src/lib/api";

type ToastLike = { warning: (m: string) => void };

// Detects a paywall error (402 or 403 with upgrade_required), shows a friendly
// prompt and routes to My plan (the request was authenticated, so the user is
// logged in). Returns true when it handled the error so the caller can skip its
// own toast. Backend's require_interaction() raises 403.
export function handleUpgrade(e: any, toast: ToastLike): boolean {
  if (e instanceof ApiError && (e.status === 402 || e.status === 403) && e.code === "upgrade_required") {
    toast.warning(e.message || "Upgrade to unlock this feature.");
    router.push("/(tabs)/profile/my-plan");
    return true;
  }
  return false;
}

// Free-account comment boxes: as soon as they get focus, nudge and route to My
// plan (same prompt+redirect as the paywall catch). Callers also blur the field
// and clear any draft so no unsent text is left behind.
export function promptCommentUpgrade(toast: { warning: (m: string) => void }, message = "Upgrade to join the conversation"): void {
  toast.warning(message);
  router.push("/(tabs)/profile/my-plan");
}
