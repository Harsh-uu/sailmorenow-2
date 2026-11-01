import React, { createContext, useContext, useEffect, useRef } from "react";
import { getToken } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";

// One shared WebSocket per authenticated user. Screens subscribe to message
// types instead of opening their own sockets.
type Sub = (msg: any) => void;

const WebSocketContext = createContext<{ subscribe: (type: string, cb: Sub) => () => void }>({
  subscribe: () => () => {},
});

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const subsRef = useRef<Map<string, Set<Sub>>>(new Map());
  const closedRef = useRef(false);
  const retryRef = useRef<any>(null);

  useEffect(() => {
    closedRef.current = false;
    if (!user?.user_id) return () => {};
    let cancelled = false;

    const connect = async () => {
      try {
        const token = await getToken();
        if (cancelled || !token || !BASE) return;
        const url =
          BASE.replace(/^http/, "ws") + `/api/ws/${user.user_id}?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          let msg: any;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          const bucket = subsRef.current.get(msg?.type);
          if (bucket) bucket.forEach((cb) => cb(msg));
          const wildcard = subsRef.current.get("*");
          if (wildcard) wildcard.forEach((cb) => cb(msg));
        };
        ws.onclose = () => {
          if (closedRef.current || cancelled) return;
          retryRef.current = setTimeout(connect, 3000);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* noop */
          }
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
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
  }, [user?.user_id]);

  const subscribe = (type: string, cb: Sub) => {
    const bucket = subsRef.current.get(type) || new Set<Sub>();
    bucket.add(cb);
    subsRef.current.set(type, bucket);
    return () => {
      const b = subsRef.current.get(type);
      if (!b) return;
      b.delete(cb);
      if (b.size === 0) subsRef.current.delete(type);
    };
  };

  return <WebSocketContext.Provider value={{ subscribe }}>{children}</WebSocketContext.Provider>;
}

export const useAppSocket = () => useContext(WebSocketContext);
