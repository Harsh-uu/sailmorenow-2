import { toast } from "sonner";

// Build an absolute, shareable URL to a public web page, tagging the sharer so
// the recipient sees "X invited you" and we can attribute referrals.
export function buildShareUrl(path, ref) {
  const base = window.location.origin;
  const url = new URL(path.startsWith("http") ? path : base + path);
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}

// Use the native Web Share sheet when available; otherwise copy to clipboard.
export async function shareContent({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
      // fall through to clipboard on any share failure
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied — share it anywhere");
    return "copied";
  } catch {
    toast.error("Couldn't open share — link: " + url);
    return "failed";
  }
}
