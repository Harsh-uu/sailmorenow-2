import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Register the service worker + subscribe/unsubscribe to Web Push.
 * Returns state + helpers so any UI (Profile toggle, Digest banner…) can wire in.
 */
export default function usePushNotifications() {
  const supported = typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState(supported ? Notification.permission : "unsupported");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return setSubscribed(false);
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
      setPermission(Notification.permission);
    } catch { /* noop */ }
  }, [supported]);

  useEffect(() => { refresh(); }, [refresh]);

  const subscribe = useCallback(async () => {
    if (!supported) return toast.error("Push notifications aren't supported in this browser.");
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { toast.error("Permission denied."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const { data: key } = await api.get("/push/vapid-public-key");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.public_key),
      });
      await api.post("/push/subscribe", { subscription: sub.toJSON() });
      setSubscribed(true);
      toast.success("Push notifications turned on.");
    } catch (e) {
      toast.error(e?.message || "Failed to subscribe");
    } finally { setBusy(false); }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { subscription: sub.toJSON() });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Push notifications turned off.");
    } catch (e) {
      toast.error(e?.message || "Failed to unsubscribe");
    } finally { setBusy(false); }
  }, []);

  return { supported, subscribed, permission, busy, subscribe, unsubscribe };
}
