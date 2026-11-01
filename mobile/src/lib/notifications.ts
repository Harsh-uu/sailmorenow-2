// Single source of truth for notification iconography + tap destination on
// mobile. Mirrors the web mapping in frontend/src/components/NotificationsBell.jsx.
// The destination resolver lives HERE (not inside a screen) so that both the
// in-app notifications list AND a future push-tap handler route identically.

export type Notif = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  read: boolean;
  created_at: string;
  link?: string;
  meta?: Record<string, any>;
};

// Ionicons glyph per kind (Icon falls back to raw Ionicons for non-semantic
// names). Chosen to match the web icons as closely as the two icon sets allow.
export const NOTIF_ICON: Record<string, string> = {
  review_request: "star-outline",
  review_accepted: "thumbs-up-outline",
  review_rejected: "thumbs-down-outline",
  review_completed: "shield-checkmark-outline",
  review_nudge: "heart-outline",
  dm: "mail-outline",
  comment: "chatbubble-outline",
  mention: "at-outline",
  crew_join: "people-outline",
  event_blast: "megaphone-outline",
  event_updated: "calendar-outline",
  event_reminder: "calendar-outline",
  event_rsvp: "calendar-outline",
  event_cancelled: "close-circle-outline",
  content_hidden: "flag-outline",
  blog_approved: "document-text-outline",
  price_drop: "pricetag-outline",
  saved_search: "pricetag-outline",
  subscription_expiring: "card-outline",
};

export function notifIcon(kind: string): string {
  return NOTIF_ICON[kind] || "notifications-outline";
}

// Resolve the mobile route a notification opens. Returns null when the row has
// no navigable destination (e.g. content_hidden carries inline moderate actions).
export function notificationHref(n: Notif): string | null {
  const meta = n.meta || {};
  const kind = n.kind || "";
  if (kind.startsWith("review_")) {
    return meta.session_id ? `/profile/reviews?session=${meta.session_id}` : "/profile/reviews";
  }
  switch (kind) {
    case "dm":
      if (meta.locked) return "/pricing";
      if (meta.is_group && meta.thread_id) return `/messages/${meta.thread_id}?group=1`;
      if (meta.from_id) {
        const parts: string[] = [];
        if (meta.thread_id) parts.push(`thread=${encodeURIComponent(meta.thread_id)}`);
        if (meta.from_name) parts.push(`name=${encodeURIComponent(meta.from_name)}`);
        return `/messages/${meta.from_id}${parts.length ? "?" + parts.join("&") : ""}`;
      }
      return "/messages";
    case "comment":
    case "mention":
      return meta.post_id ? `/post/${meta.post_id}` : "/feed";
    case "event_blast":
    case "event_updated":
    case "event_cancelled":
    case "event_reminder":
      return meta.event_id ? `/events/${meta.event_id}` : "/events";
    case "event_rsvp":
      return meta.event_id ? `/event-roster?id=${meta.event_id}&kind=${meta.kind || "attendee"}` : "/events";
    case "crew_join":
      return "/crew-bank";
    case "blog_approved":
      return meta.discussion_id ? `/hub/${meta.discussion_id}` : "/hub";
    case "price_drop":
    case "saved_search":
      return "/feed";
    case "subscription_expiring":
      return "/pricing";
    case "blog_pending":
      return "/admin?tab=approvals";
    case "report_new":
      return "/admin?tab=reports";
    default:
      return null;
  }
}
