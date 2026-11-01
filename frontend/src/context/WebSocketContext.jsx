import { createContext, useContext, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * A single shared WebSocket per authenticated user. Components subscribe to
 * message types instead of opening their own sockets — this avoids clobbering
 * previously-registered sockets in the backend WSManager and cuts down on
 * connection churn from unmount/remount cycles.
 */
const WebSocketContext = createContext({ subscribe: () => () => {} });

export function WebSocketProvider({ children }) {
  const { user } = useAuth();
  const wsRef = useRef(null);
  const subsRef = useRef(new Map()); // type -> Set(callback)
  const closedRef = useRef(false);
  const retryRef = useRef(null);

  useEffect(() => {
    closedRef.current = false;
    if (!user?.user_id) return () => {};

    const backend = process.env.REACT_APP_BACKEND_URL || window.location.origin;
    let cancelled = false;

    const connect = async () => {
      try {
        const { data: t } = await api.get("/auth/ws-token");
        if (cancelled) return;
        const url = backend.replace(/^http/, "ws") + `/api/ws/${t.user_id}?token=${encodeURIComponent(t.token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          const bucket = subsRef.current.get(msg?.type);
          if (bucket) bucket.forEach((cb) => { try { cb(msg); } catch { /* noop */ } });
          const wildcard = subsRef.current.get("*");
          if (wildcard) wildcard.forEach((cb) => { try { cb(msg); } catch { /* noop */ } });
        };
        ws.onclose = () => {
          if (closedRef.current || cancelled) return;
          // Retry after a short backoff so live updates auto-heal.
          retryRef.current = setTimeout(connect, 3000);
        };
      } catch {
        if (!cancelled) retryRef.current = setTimeout(connect, 5000);
      }
    };
    connect();

    return () => {
      cancelled = true;
      closedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      try { wsRef.current?.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
  }, [user?.user_id]);

  const subscribe = (type, cb) => {
    const bucket = subsRef.current.get(type) || new Set();
    bucket.add(cb);
    subsRef.current.set(type, bucket);
    return () => {
      const b = subsRef.current.get(type);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) subsRef.current.delete(type);
    };
  };

  return (
    <WebSocketContext.Provider value={{ subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useAppSocket() {
  return useContext(WebSocketContext);
}
