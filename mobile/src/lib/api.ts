// Shared API client for the mobile app. Talks to the SAME FastAPI backend as
// web. Auth transport on mobile is a Bearer token (session_token) stored in
// expo-secure-store — never cookies.
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API = `${BASE}/api`;

export const AUTH_TOKEN_KEY = "session_token";

export async function getToken(): Promise<string | null> {
  return await storage.secureGet(AUTH_TOKEN_KEY, null);
}
export async function setToken(token: string): Promise<void> {
  await storage.secureSet(AUTH_TOKEN_KEY, token);
}
export async function clearToken(): Promise<void> {
  await storage.secureRemove(AUTH_TOKEN_KEY);
}

type Options = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function detailToMessage(detail: any, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  if (typeof detail === "object" && detail.message) return detail.message;
  return JSON.stringify(detail);
}

export async function apiRequest<T = any>(path: string, opts: Options = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Network error — check your connection.", 0);
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const code = data?.detail && typeof data.detail === "object" ? data.detail.code : undefined;
    throw new ApiError(detailToMessage(data?.detail, `Request failed (${res.status})`), res.status, code);
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => apiRequest<T>(path, { method: "GET" }),
  post: <T = any>(path: string, body?: any) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T = any>(path: string, body?: any) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T = any>(path: string, body?: any) => apiRequest<T>(path, { method: "PUT", body }),
  del: <T = any>(path: string, body?: any) => apiRequest<T>(path, { method: "DELETE", body }),
};

// Brand assets reused from web.
export const LOGO_HORIZONTAL_DARK =
  "https://customer-assets-cm19k8pv.emergentagent.net/job_437f721b-2788-4937-a9fb-57636aed9653/artifacts/ltl45p7r_SMN_Logo_Horizontal_DarkBG.webp";
export const LOGO_ROUND =
  "https://customer-assets-cm19k8pv.emergentagent.net/job_437f721b-2788-4937-a9fb-57636aed9653/artifacts/wrznd832_smn_round_logo_transparent.png";
export const HERO_IMG =
  "https://customer-assets-cm19k8pv.emergentagent.net/job_437f721b-2788-4937-a9fb-57636aed9653/artifacts/akv20ye7_IMG_3476.webp";
