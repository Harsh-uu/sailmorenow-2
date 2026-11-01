import { Share } from "react-native";

// Mobile shares link out to the public WEB pages (same host serves the web
// app), so recipients without the app can still view + sign up.
const WEB = process.env.EXPO_PUBLIC_BACKEND_URL;

export function buildShareUrl(path: string, ref?: string | null): string {
  const sep = path.includes("?") ? "&" : "?";
  const refQ = ref ? `${sep}ref=${encodeURIComponent(ref)}` : "";
  return `${WEB}${path}${refQ}`;
}

export async function shareLink(message: string, path: string, ref?: string | null): Promise<void> {
  const url = buildShareUrl(path, ref);
  try {
    await Share.share({ message: `${message}\n\n${url}`, url });
  } catch {
    /* user dismissed */
  }
}
