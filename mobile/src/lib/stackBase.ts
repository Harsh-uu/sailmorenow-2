import { useSegments, useRouter } from "expo-router";

// Returns the current tab-stack base, e.g. "/feed", "/directory", "/profile".
// When the screen is mounted at the app root (outside the tabs), returns "".
// Shared detail screens use this so a push stays inside the tab the user is in,
// keeping the bottom tab bar visible and Back returning to the previous screen.
export function useStackBase(): string {
  const segments = useSegments() as string[];
  if (segments[0] === "(tabs)" && segments[1]) return `/${segments[1]}`;
  return "";
}

// Convenience: push a tab-relative path (e.g. go(`/post/${id}`)).
export function useGo() {
  const base = useStackBase();
  const router = useRouter();
  return (path: string) => router.push(`${base}${path}` as never);
}
