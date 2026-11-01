import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext({ user: null, loading: true, refresh: () => {}, logout: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    window.location.href = "/";
  }, []);

  // Switch the account's active identity (personal | business). Optimistically
  // updates the cached user, then refreshes from the server.
  const setActiveIdentity = useCallback(async (identity) => {
    const { data } = await api.put("/account/active-identity", { identity });
    setUser((u) => (u ? { ...u, active_identity: data.active_identity } : u));
    refresh();
    return data;
  }, [refresh]);

  return <AuthCtx.Provider value={{ user, loading, refresh, logout, setUser, setActiveIdentity }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
