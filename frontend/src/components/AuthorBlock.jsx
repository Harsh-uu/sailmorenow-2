import { Link } from "react-router-dom";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import AuthorLink from "@/components/AuthorLink";

/**
 * Shared "who wrote this" block (Step 8a). SINGLE source of truth for rendering
 * an author anywhere on the web: feed, forum, blog, marketplace, comments,
 * replies, activity cards, message thread headers and reviews.
 *
 *  - personal identity → personal name + personal photo (Avatar, standard
 *    rules — no white circle) linking to /u/<handle> (with hover preview card).
 *  - business identity → business name + the business logo inside the shared
 *    LogoCircle (fixed white background, initial fallback) linking to the
 *    public listing /directory/<businessId>.
 *
 * No tier names or tier badges are ever rendered here.
 */
export function authorFromDoc(d) {
  return {
    identity: d?.author_identity === "business" ? "business" : "personal",
    name: d?.author_name,
    avatar: d?.author_avatar,
    handle: d?.author_handle,
    businessId: d?.author_business_id,
  };
}

export default function AuthorBlock({
  identity, name, avatar, handle, businessId,
  size = "h-9 w-9", nameClassName = "text-sm font-semibold text-[#1F3F5B] dark:text-slate-100",
  testId, extras = null, subline = null, stop = true,
}) {
  const isBiz = identity === "business";
  const label = name || (isBiz ? "Business" : "Anonymous");
  const initial = (label[0] || (isBiz ? "P" : "?")).toUpperCase();
  const avatarEl = isBiz
    ? <LogoCircle src={avatar} size={size} alt={label} testId={testId && `${testId}-logo`}
        fallback={<span className="font-bold text-[#1F3F5B]">{initial}</span>} />
    : <Avatar src={avatar} className={size} alt={label} testId={testId && `${testId}-avatar`} />;
  const stopFn = (e) => { if (stop) e.stopPropagation(); };

  // Business author → link straight to the public directory listing.
  if (isBiz) {
    const to = businessId ? `/directory/${businessId}` : null;
    const linkedAvatar = to ? <Link to={to} onClick={stopFn} data-testid={testId && `${testId}-avatar-link`}>{avatarEl}</Link> : avatarEl;
    const linkedName = to
      ? <Link to={to} onClick={stopFn} data-testid={testId} className="truncate hover:underline">{label}</Link>
      : <span className="truncate" data-testid={testId}>{label}</span>;
    return (
      <div className="flex items-center gap-3 min-w-0">
        {linkedAvatar}
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 min-w-0 ${nameClassName}`}>{linkedName}{extras}</div>
          {subline}
        </div>
      </div>
    );
  }

  // Personal author → AuthorLink (hover preview + /u/<handle>).
  return (
    <div className="flex items-center gap-3 min-w-0">
      <AuthorLink handle={handle} testId={testId && `${testId}-avatar-link`}>{avatarEl}</AuthorLink>
      <div className="min-w-0">
        <div className={`flex items-center gap-1.5 min-w-0 ${nameClassName}`}>
          <AuthorLink handle={handle} testId={testId} className="truncate">{label}</AuthorLink>
          {extras}
        </div>
        {subline}
      </div>
    </div>
  );
}
