import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";

// Keeps the notification unread count and the pending-reviews count fresh for
// the bell badge and the Profile "Reviews" row — WITHOUT push. It refreshes on
// mount, when the app returns to the foreground, and every 60s while in the
// foreground. Background polling is stopped. Screens also call refresh() after
// any action (mark read, mark all) and on focus.

type Ctx = {
  unread: number;
  pendingReviews: number;
  refresh: () => Promise<void>;
};

const NotificationsCtx = createContext<Ctx>({ unread: 0, pendingReviews: 0, refresh: async () => {} });
const POLL_MS = 60000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [pendingReviews, setPendingReviews] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.user_id) { setUnread(0); setPendingReviews(0); return; }
    try {
      const d = await api.get<{ unread?: number }>("/notifications?limit=1");
      setUnread(d?.unread || 0);
    } catch { /* keep last value */ }
    try {
      const list = await api.get<any[]>("/review-sessions/mine");
      const pending = (list || []).filter((s) => {
        if (s?.status !== "pending") return false;
        const me = (s.participants || []).find((p: any) => p.user_id === user.user_id);
        return me && !me.is_reviewer; // viewer is the reviewee, awaiting response
      }).length;
      setPendingReviews(pending);
    } catch { /* keep last value */ }
  }, [user?.user_id]);

  const startPolling = useCallback(() => {
    if (timer.current) return;
    timer.current = setInterval(refresh, POLL_MS);
  }, [refresh]);
  const stopPolling = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);

  useEffect(() => {
    if (!user?.user_id) { stopPolling(); setUnread(0); setPendingReviews(0); return; }
    refresh();
    startPolling();
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") { refresh(); startPolling(); }
      else stopPolling(); // no background polling
    });
    return () => { sub.remove(); stopPolling(); };
  }, [user?.user_id, refresh, startPolling, stopPolling]);

  return (
    <NotificationsCtx.Provider value={{ unread, pendingReviews, refresh }}>
      {children}
    </NotificationsCtx.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsCtx);
}
