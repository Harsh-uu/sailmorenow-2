import { api } from "@/lib/api";

const SESSION_KEY = "smn-hero-session";

function sessionId() {
  try {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = (crypto.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch { return `s_${Date.now()}`; }
}

/**
 * Fire-and-forget landing-hero event logger. Failures are silent — we don't
 * want analytics to block a page load or a sign-up click.
 */
export function logHeroEvent(event, clip) {
  try {
    api.post("/analytics/hero", { event, clip, session_id: sessionId() }).catch(() => {});
  } catch { /* offline / adblocker — ignore */ }
}
