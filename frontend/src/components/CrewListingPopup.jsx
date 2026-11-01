import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import Avatar from "@/components/Avatar";
import MessageLink from "@/components/MessageLink";
import Modal from "@/components/Modal";
import { api } from "@/lib/api";
import { formatEventDate, eventTitleParts } from "@/lib/eventCategories";
import { displayPosition } from "@/lib/crewPositions";

// Shared Crew Bank listing detail view (web). Mirrors the mobile
// CrewListingPopup: takes either a standalone Crew Bank entry or an event
// crew-pool entry and shows every field the sailor provided. Avatar/name link
// to the profile; Message (others, via MessageLink) or Edit (your own listing).
let cachedAxes = null;

function Section({ label, children }) {
  return (
    <div className="mt-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      {children}
    </div>
  );
}

export function CrewListingView({ entry, currentUser, eventContext, onBack, onEditOwn }) {
  const [styleAxes, setStyleAxes] = useState(cachedAxes || []);

  useEffect(() => {
    if (cachedAxes) return;
    api.get("/markets").then(({ data }) => { cachedAxes = data.sailing_style_axes || []; setStyleAxes(cachedAxes); }).catch(() => {});
  }, []);

  if (!entry) return null;

  const name = entry.user_name || "Sailor";
  const handle = entry.user_handle;
  const isMine = !!entry.user_id && entry.user_id === currentUser?.user_id;
  // Event crew entries are about one event, so they never show a Markets line
  // (standalone listings keep theirs). Event entries carry event_id.
  const isEvent = !!entry.event_id;
  const markets = Array.isArray(entry.markets) && entry.markets.length ? entry.markets : null;
  const marketLine = isEvent ? "" : (markets ? markets.join(" · ") : (entry.user_market || entry.user_primary_market || ""));
  const positions = entry.positions && entry.positions.length ? entry.positions : [];
  const expTypes = entry.experience_types || [];
  const style = entry.sailing_style || null;
  const contactLabel = entry.contact_via === "email" ? "Email" : "In-app message";

  return (
    <div className="p-5" data-testid={`crew-detail-${entry.user_id}`}>
      {onBack && (
        <button onClick={onBack} data-testid="crew-detail-back"
                className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1F3F5B] hover:text-[#152a3d] rounded-full border border-slate-200 px-3 py-1.5">
          <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back
        </button>
      )}

      <div className="flex items-start gap-3">
        {handle ? (
          <Link to={`/u/${handle}`} data-testid={`crew-detail-avatar-${entry.user_id}`} className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Avatar src={entry.user_avatar} className="h-14 w-14" alt={name} />
          </Link>
        ) : (
          <Avatar src={entry.user_avatar} className="h-14 w-14 shrink-0" alt={name} />
        )}
        <div className="min-w-0">
          <div className="text-lg font-bold text-[#1F3F5B] leading-tight flex items-center gap-1 flex-wrap">
            {handle ? (
              <Link to={`/u/${handle}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>
            ) : name}
            {entry.user_verified && <Icon name="verified" tone="current" className="h-4 w-4 text-[#55B3AD] shrink-0" data-testid={`crew-detail-verified-${entry.user_id}`} />}
          </div>
          {marketLine && <div className="text-xs text-slate-500 mt-0.5">{marketLine}</div>}
          {handle && (
            <Link to={`/u/${handle}`} data-testid={`crew-detail-profile-${entry.user_id}`} onClick={(e) => e.stopPropagation()}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#55B3AD] hover:underline">
              View profile <Icon name="chevron-right" tone="current" className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {eventContext?.title && (
        <div className="mt-3 text-sm text-slate-600" data-testid={`crew-detail-event-${entry.user_id}`}>
          Crew for: {eventTitleParts(eventContext.title).title}{eventContext.starts_at ? `, ${formatEventDate(eventContext.starts_at, eventContext.time_not_listed)}` : ""}
        </div>
      )}

      {entry.user_bio && <p className="mt-4 text-sm text-slate-600">{entry.user_bio}</p>}

      {positions.length > 0 && (
        <Section label="Positions">
          <div className="mt-1 flex flex-wrap gap-1">
            {positions.map((p) => <span key={p} className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{displayPosition(p)}</span>)}
          </div>
        </Section>
      )}

      {expTypes.length > 0 && (
        <Section label="Sailing experience">
          <div className="mt-1 flex flex-wrap gap-1" data-testid={`crew-detail-exp-${entry.user_id}`}>
            {expTypes.map((t) => <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871]">{t}</span>)}
          </div>
        </Section>
      )}

      {style && styleAxes.length > 0 && styleAxes.some((ax) => style[ax.key]) && (
        <Section label="Sailing style">
          {styleAxes.filter((ax) => style[ax.key]).map((ax) => (
            <div key={ax.key} className="mt-2">
              <div className="flex justify-between text-[10px] text-slate-500"><span>{ax.low}</span><span>{ax.high}</span></div>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => <div key={n} className={`flex-1 h-1.5 rounded-full ${style[ax.key] === n ? "bg-[#55B3AD]" : "bg-slate-200"}`} />)}
              </div>
            </div>
          ))}
        </Section>
      )}

      {entry.experience && <Section label="Experience"><p className="mt-1 text-sm text-slate-600">{entry.experience}</p></Section>}
      {entry.availability && <Section label="Availability"><p className="mt-1 text-sm text-slate-600">{entry.availability}</p></Section>}
      {entry.notes && <Section label="Notes for the skipper"><p className="mt-1 text-sm text-slate-600 italic">&ldquo;{entry.notes}&rdquo;</p></Section>}

      <Section label="Contact">
        <p className="mt-1 text-sm text-slate-600">Prefers contact via: {contactLabel}</p>
        {entry.user_email && <p className="text-sm text-slate-600">{entry.user_email}</p>}
      </Section>

      <div className="mt-6">
        {isMine ? (
          onEditOwn ? (
            <button onClick={onEditOwn} data-testid={`crew-detail-edit-${entry.user_id}`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-white bg-[#1F3F5B] hover:bg-[#152a3d] rounded-full px-4 py-2">
              <Icon name="edit" tone="current" className="h-4 w-4" /> Edit listing
            </button>
          ) : (
            <span className="text-xs font-semibold text-slate-400">This is your listing</span>
          )
        ) : (
          <MessageLink toUserId={entry.user_id} testId={`crew-detail-dm-${entry.user_id}`}
                       className="inline-flex items-center gap-1 text-sm font-semibold text-white bg-[#1F3F5B] hover:bg-[#152a3d] rounded-full px-4 py-2">
            <Icon name="message-square" tone="current" className="h-4 w-4" /> Message {name.split(" ")[0] || "sailor"}
          </MessageLink>
        )}
      </div>
    </div>
  );
}

export default function CrewListingPopup({ open, entry, currentUser, onClose, onEditOwn }) {
  return (
    <Modal open={open} onClose={onClose} title="Crew profile" testId="crew-detail-modal">
      {entry && <CrewListingView entry={entry} currentUser={currentUser} onEditOwn={onEditOwn} />}
    </Modal>
  );
}
