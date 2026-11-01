// App-wide DeviceEventEmitter event names. Used to refresh screens after a
// full-screen form route (review compose, admin edit) submits and pops back.
export const REVIEWS_CHANGED = "reviews:changed";
export const ADMIN_CONTENT_CHANGED = "admin:content-changed";
export const ADMIN_SUPPORT_CHANGED = "admin:support-changed";
export const ADMIN_FAQS_CHANGED = "admin:faqs-changed";
// Marketplace For-Sale listing edited or deleted (full-screen edit / delete
// routes emit this so the post detail and "My listings" refresh on pop back).
// Payload: { id: string; next: any | null }  (next = updated post, null = deleted)
export const MARKETPLACE_CHANGED = "marketplace:changed";
// One shared "a list should refresh" signal across the app. Emitted after any
// create / edit / delete of feed posts, discussions (forum/blog), events and
// crew listings so the Feed and Events lists update without a manual refresh.
// Payload: { kind: "post" | "discussion" | "event" | "crew";
//            action: "create" | "edit" | "delete"; item?: any; id?: string }
// `item` (when present on a create) lets a recency-sorted list prepend it
// optimistically; a refetch always follows and reconciles by id.
export const CONTENT_CHANGED = "content:changed";
