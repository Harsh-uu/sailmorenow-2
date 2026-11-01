import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { router } from "expo-router";

import { api, clearToken, setToken } from "@/src/lib/api";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
const AUTH_BASE = "https://auth.emergentagent.com/";

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  avatar?: string | null;
  handle?: string | null;
  account_type?: string | null;
  primary_market?: string | null;
  markets?: string[];
  subscription_tier?: string;
  subscription_expires?: string | null;
  newsletter_opt_in?: boolean;
  onboarding_complete?: boolean;
  platform_role?: string | null;
  identity_verified?: boolean;
  bio?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  org_category?: string | null;
  org_categories?: string[];
  org_name?: string | null;
  website?: string | null;
  boat_name?: string | null;
  boat_make_model?: string | null;
  active_identity?: string;
  can_use_business?: boolean;
  business_name?: string | null;
  business_logo?: string | null;
  business_listing_id?: string | null;
};

type AuthCtxType = {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  login: () => Promise<void>;
  emailLogin: (email: string, password: string) => Promise<void>;
  register: (payload: Record<string, any>) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
};

const AuthCtx = createContext<AuthCtxType>({
  user: null,
  loading: true,
  signingIn: false,
  login: async () => {},
  emailLogin: async () => {},
  register: async () => {},
  logout: async () => {},
  refresh: async () => null,
});

function parseSessionId(url: string | null): string | null {
  if (!url) return null;
  const hash = url.includes("#") ? url.split("#")[1] : "";
  const query = url.includes("?") ? url.split("?")[1]?.split("#")[0] : "";
  for (const part of [hash, query]) {
    if (!part) continue;
    const m = part.match(/session_id=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const exchanging = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<User>("/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const exchange = useCallback(
    async (sessionId: string): Promise<User | null> => {
      if (exchanging.current) return null;
      exchanging.current = true;
      try {
        const data = await api.post<{ user: User; session_token: string }>("/auth/session", {
          session_id: sessionId,
        });
        await setToken(data.session_token);
        setUser(data.user);
        setLoading(false);
        return data.user;
      } catch {
        // fall through to a normal /me check
        return await refresh();
      } finally {
        exchanging.current = false;
      }
    },
    [refresh],
  );

  // Cold-start + hot deep links (native) / URL fragment (web preview).
  useEffect(() => {
    let sub: any;
    (async () => {
      if (Platform.OS === "web") {
        const sid = parseSessionId(typeof window !== "undefined" ? window.location.href : null);
        if (sid) {
          await exchange(sid);
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", window.location.pathname);
          }
          return;
        }
      } else {
        const initial = await Linking.getInitialURL();
        const sid = parseSessionId(initial);
        if (sid) {
          await exchange(sid);
          return;
        }
        sub = Linking.addEventListener("url", ({ url }) => {
          const s = parseSessionId(url);
          if (s) exchange(s).then((u) => { if (u) router.replace(u.onboarding_complete ? "/(tabs)/feed" : "/onboarding"); });
        });
      }
      await refresh();
    })();
    return () => {
      sub?.remove?.();
    };
  }, [exchange, refresh]);

  const login = useCallback(async () => {
    setSigningIn(true);
    try {
      const redirectUrl =
        Platform.OS === "web"
          ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
          : Linking.createURL("auth");
      const authUrl = `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl)}`;
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === "success" && result.url) {
        const sid = parseSessionId(result.url);
        if (sid) {
          const u = await exchange(sid);
          if (u) router.replace(u.onboarding_complete ? "/(tabs)/feed" : "/onboarding");
        }
      }
    } finally {
      setSigningIn(false);
    }
  }, [exchange]);

  const emailLogin = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User; session_token: string }>("/auth/login", { email, password });
    await setToken(data.session_token);
    setUser(data.user);
    setLoading(false);
  }, []);

  const register = useCallback(async (payload: Record<string, any>) => {
    const data = await api.post<{ user: User; session_token: string }>("/auth/register", payload);
    await setToken(data.session_token);
    setUser(data.user);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, signingIn, login, emailLogin, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
