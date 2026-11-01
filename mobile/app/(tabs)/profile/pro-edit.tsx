import { Redirect } from "expo-router";

// The old split editor was consolidated into /profile/boat-pro-listing.
// Keep this route as a redirect so existing deep links do not break.
export default function ProEditRedirect() {
  return <Redirect href="/profile/boat-pro-listing" />;
}
