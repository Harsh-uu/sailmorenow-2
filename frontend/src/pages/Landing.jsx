import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, PRO_IMG, COMMUNITY_IMG, EVENTS_IMG } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import { useAuth } from "@/context/AuthContext";
import FoundingWall from "@/components/FoundingWall";
import LiveNowWidget from "@/components/LiveNowWidget";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";
import InviteBanner from "@/components/InviteBanner";
import TestimonialsStrip from "@/components/TestimonialsStrip";
import DirectoryPreview from "@/components/DirectoryPreview";
import { logHeroEvent } from "@/lib/heroAnalytics";

const UPGRADE_NOTE = "Free accounts can look around - Premium ($6.99/mo) unlocks the good stuff.";

const ROLE_PATHS = [
  {
    key: "sailor", label: "Sailor", icon: "crew", price: "Free · Premium $6.99/mo",
    tagline: "Get more time on the water and plug into the community.",
    free: [
      "Browse Crew and Volunteer opportunities",
      "Post, comment and react in the feed and hub",
      "See what other sailors are talking about",
      "Access directory of local Clubs & Boat Pros",
      "Get involved in your local sailing scene",
    ],
    premiumTitle: "Why go Premium", premiumNote: UPGRADE_NOTE,
    premium: [
      "Get listed in the Crew Bank",
      "Direct messaging with owners, sailors & pros",
      "Leave & receive reviews",
      "Enhanced profile with an ID-verified badge",
    ],
  },
  {
    key: "boat_owner", label: "Boat Owner", icon: "boatOwner", price: "Free · Premium $6.99/mo",
    tagline: "Find crew, hire trusted pros, and plan your whole season.",
    free: [
      "Browse Crew Banks - seasonal and per event",
      "Post crew opportunities, comment and react",
      "Browse directory of local Boat Pros & Clubs",
      "See what's happening in your local community",
      "Live Events calendar",
    ],
    premiumTitle: "Why go Premium", premiumNote: UPGRADE_NOTE,
    premium: [
      "Direct Messaging with potential crew, clubs & pros",
      "Leave & receive reviews",
      "Enhanced profile with an ID-verified badge",
    ],
  },
  {
    key: "boat_pro", label: "Boat Pro", icon: "boatPro", price: "Basic $12.99/mo · Featured $19.99/mo · Premium $29.99/mo",
    tagline: "Get discovered by boat owners in your local market.",
    free: [
      "Listed in the Boat Pros directory",
      "Direct messaging with potential customers",
      "Showcase services & get reviews",
      "Target the markets you serve",
      "Enhanced listings on higher tiers",
    ],
    premiumTitle: "Boat Pro plans",
    premium: [
      "Basic $12.99/mo: Email/website, 1+ Categories, Local market, 2-way reviews, direct messaging",
      "Featured $19.99/mo: Basic plus- 2 markets, logo & cover photo, enhanced listing",
      "Premium $29.99/mo: Featured plus- Unlimited markets, 5 gallery photos, trust and credentials, top directory placement",
    ],
  },
  {
    key: "partner", label: "Organization", icon: "org", price: "Free to join",
    tagline: "Expand your reach and grow your sailing programs.",
    free: [
      "Get listed in Clubs & Orgs Directory",
      "Build following of potential members",
      "Post 1 volunteer event and 1 update (including a marketplace listing) each calendar month",
      "RSVPs & attendee notifications",
      "Get reviews and build reputation",
    ],
    premiumTitle: "Become a Community Partner",
    premiumNote: "Gets your club on every sailor's radar.",
    premium: [
      "Direct messaging with owners, sailors & pros",
      "Enhanced profile",
      "Unlimited calendar event posts",
      "Interact - post & respond on forums and feeds",
      "Founding Partners get home-page recognition and an annual newsletter bio",
    ],
    partner: true,
  },
];

const handleLogin = (clip) => {
  logHeroEvent("signup_click", clip);
  window.location.href = "/register";
};

// Sticky header is h-16, so pull the hero UP by that height and pad the top
// back down so content clears the header. Mobile pb is much tighter than
// laptop so the page doesn't feel airy on small screens.
const HERO_OFFSET = "-mt-16 pt-20 sm:pt-24";

// Waves live INSIDE the section they cut into, so the color above the curve
// is always the previous section's real background (gradients included) and
// the color below is the section's own — no seams, no straight lines.
const WAVE_H = "clamp(32px, 6vw, 70px)";
// Boundary wave BETWEEN two sections (never inside one). The area ABOVE the
// curve is painted `fill` (the section ABOVE's color); the wrapper's `below`
// background (the section BELOW's color) shows through beneath the curve.
function Wave({ fill, below, flip = false, testId }) {
  const path = flip
    ? "M0,120 L1440,120 L1440,60 C1200,20 960,100 720,60 C480,20 240,100 0,60 Z"
    : "M0,0 L1440,0 L1440,60 C1200,100 960,20 720,60 C480,100 240,20 0,60 Z";
  return (
    <div aria-hidden="true" data-testid={testId} className={`w-full overflow-hidden leading-none pointer-events-none block ${below}`} style={{ height: WAVE_H, marginTop: "-1px", marginBottom: "-1px" }}>
      <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className={`block w-full h-full fill-current ${fill}`} role="presentation"><path d={path} /></svg>
    </div>
  );
}

const HERO_CLIPS = ["hero-loop-portrait", "hero-loop-alt-portrait"];
const HERO_POSTERS = {
  "hero-loop-portrait": "/hero-poster.jpg",
  "hero-loop-alt-portrait": "/hero-poster-alt.jpg",
};

// Single switch to hide BOTH live counters (the LiveNowWidget strip and the
// CommunityStats stat tiles). Flip to true to show them again; code kept intact.
const SHOW_LIVE_COUNTERS = false;

// "What is Sail More Now" content, now a one-card-at-a-time hero carousel.
// Cards 4-6 (no photo) take title+desc verbatim from mobile/app/index.tsx
// FEATURES and render with a project glyph (crew / messages / reviews).
const HERO_CARDS = [
  { icon: "community", title: "Activities Hub", desc: "Post crew openings and volunteer opportunities, buy and sell on local marketplaces, and chat with sailors, Clubs and Boat Pros directly.", img: "/dock-talk-upright.webp", pos: "object-[50%_42%]", cta: "Open the feed", to: "/feed" },
  { icon: "boatPro", title: "Boat Pro Directory", desc: "Find riggers, mechanics, sailmakers, surveyors, instructors and more. Filtered to your market.", img: PRO_IMG, cta: "Browse directory", to: "/directory" },
  { icon: "org", title: "Directory of Clubs & Organizations", desc: "Find and learn more about clubs and organizations in your area", img: "/clubs-orgs.webp", pos: "object-[50%_60%]", cta: "Browse clubs & organizations", to: "/clubs" },
  { icon: "events", title: "Events calendar", desc: "Regattas, rendezvous, and volunteer days across all ten PNW markets in one place.", img: EVENTS_IMG, cta: "See events", to: "/events" },
  { icon: "crew", title: "Crew Bank", desc: "Seasonal and per event crew banks with detailed profiles. Find crew/get listed.", img: "/crew-bank.webp", pos: "object-[50%_38%]" },
  { icon: "messages", title: "Direct messaging", desc: "Connect privately with sailors, owners, clubs & Boat Pros.", img: "/direct-messaging.webp", fit: "contain", imgBg: "bg-[#0b1220]" },
  { icon: "reviews", title: "Reviews & ratings", desc: "Two-way review system builds trust and reputation", img: "/reviews-card.webp", fit: "contain", imgBg: "bg-[#0b1220]" },
];

function HeroCarousel() {
  const [idx, setIdx] = useState(0);
  const n = HERO_CARDS.length;
  const go = (d) => setIdx((i) => (i + d + n) % n);
  const touch = useRef(null);
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = HERO_CARDS[idx];
  return (
    <div className="w-full max-w-[340px] sm:max-w-[420px]" data-testid="hero-carousel"
      tabIndex={0} role="group" aria-roledescription="carousel" aria-label="What is Sail More Now"
      onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); } if (e.key === "ArrowRight") { e.preventDefault(); go(1); } }}
      onTouchStart={(e) => { touch.current = e.changedTouches[0].clientX; }}
      onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}
    >
      <div className={`relative rounded-3xl overflow-hidden shadow-2xl ring-1 ring-black/5 bg-white dark:bg-slate-800 ${reduce ? "" : "transition-opacity duration-300"}`} data-testid={`hero-card-${idx}`}>
        {c.img ? (
          <div className={`aspect-[16/10] overflow-hidden ${c.imgBg || ""}`}><img src={c.img} alt={c.title} className={`w-full h-full ${c.fit === "contain" ? "object-contain" : "object-cover"} ${c.pos || ""}`} /></div>
        ) : (
          <div className="aspect-[16/10] flex items-center justify-center bg-[#55B3AD]/12"><Icon name={c.icon} size={56} tone="brand" /></div>
        )}
        <div className="p-5 min-h-[150px]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#55B3AD]/12 flex items-center justify-center shrink-0"><Icon name={c.icon} size={20} tone="brand" /></div>
            <h3 className="font-display font-bold text-xl smn-heading">{c.title}</h3>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">{c.desc}</p>
          {c.cta && <Link to={c.to} className="inline-flex items-center gap-1 text-sm font-semibold text-[#B45309] dark:text-[#F2A03B] mt-4 hover:gap-2 transition-all">{c.cta} <Icon name="arrow-right" tone="current" className="h-4 w-4" /></Link>}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button onClick={() => go(-1)} aria-label="Previous card" data-testid="hero-prev" className="h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"><Icon name="chevron-left" tone="current" className="h-5 w-5" /></button>
        <div className="flex items-center gap-2" role="tablist" aria-label="Choose card">
          {HERO_CARDS.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} aria-label={`Card ${i + 1}`} aria-selected={i === idx} data-testid={`hero-dot-${i}`} className={`h-2.5 rounded-full transition-all ${i === idx ? "w-6 bg-[#F2A03B]" : "w-2.5 bg-white/40 hover:bg-white/60"}`} />
          ))}
        </div>
        <button onClick={() => go(1)} aria-label="Next card" data-testid="hero-next" className="h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"><Icon name="chevron-right" tone="current" className="h-5 w-5" /></button>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const clip = useMemo(() => HERO_CLIPS[Math.floor(Math.random() * HERO_CLIPS.length)], []);
  const poster = HERO_POSTERS[clip];
  const [params] = useSearchParams();
  const referred = !!params.get("ref");
  const roleParam = params.get("role");
  const [roleIdx, setRoleIdx] = useState(() => {
    const i = ROLE_PATHS.findIndex((p) => p.key === roleParam);
    return i >= 0 ? i : 0;
  });
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [weekEvent, setWeekEvent] = useState(undefined);
  useEffect(() => {
    const now = new Date();
    const to = new Date(now.getTime() + 7 * 864e5);
    api.get("/events", { params: { from: now.toISOString(), to: to.toISOString() } })
      .then(({ data }) => setWeekEvent((data || [])[0] || null))
      .catch(() => setWeekEvent(null));
  }, []);
  const role = ROLE_PATHS[roleIdx];
  useEffect(() => {
    if (roleParam && ROLE_PATHS.some((p) => p.key === roleParam)) {
      const t = setTimeout(() => document.querySelector('[data-testid="find-your-place"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
      return () => clearTimeout(t);
    }
  }, [roleParam]);
  useEffect(() => { logHeroEvent("shown", clip); }, [clip]);

  return (
    <div data-testid="landing-page" className="bg-[var(--smn-bg)] dark:bg-slate-950">
      {referred && (
        <div className="fixed bottom-4 inset-x-4 z-40 max-w-2xl mx-auto">
          <InviteBanner blurb="You've been invited to Sail More Now - the Pacific Northwest sailing community. Create your free account to dive in." />
        </div>
      )}
      {/* Hero — navy band with the round logo motif floating behind the H1 */}
      <section className={`smn-hero text-white relative overflow-hidden ${HERO_OFFSET} pb-20 sm:pb-28 lg:pb-36`}>
        <img
          src="/icon-512.png"
          alt=""
          aria-hidden="true"
          className="hidden lg:block absolute left-[-36px] -top-8 w-[520px] opacity-10 pointer-events-none select-none"
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-8 lg:gap-10 items-center relative">
          <div className="lg:col-span-6">
            <h1 className="font-display font-extrabold tracking-tighter leading-[1.05]"
                style={{ fontSize: "clamp(2.25rem, 4.4vw, 2.75rem)", maxWidth: "24ch" }}>
              More time on the water<br /> starts here.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-200 max-w-xl leading-relaxed">
              All the sailing resources you need for planning, promoting, hiring, and connecting. All in one place.<br />
              <span className="whitespace-nowrap">Less searching. More sailing.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => handleLogin(clip)}
                data-testid="hero-signup-btn"
                className="inline-flex items-center gap-2 bg-[#F2A03B] text-white hover:bg-[#d98c30] rounded-full px-6 py-3 font-semibold transition-colors"
              >
                Sign up today <Icon name="arrow-right" tone="current" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-4 sm:gap-6 text-sm text-slate-300">
              <div className="flex items-center gap-2"><Icon name="crew" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Dedicated Crew Banks</div>
              <div className="flex items-center gap-2"><Icon name="reviews" tone="current" className="h-4 w-4 text-[#F2A03B]" /> Trusted Boat Pros</div>
              <div className="flex items-center gap-2"><Icon name="crew" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Live activities Feed</div>
            </div>
          </div>
          <div className="lg:col-span-6 relative flex flex-col items-center lg:items-end">
            <h2 className="font-display font-bold text-white text-xl sm:text-2xl mb-4 self-start lg:self-end lg:text-right max-w-md">
              One hub for every part of<br className="hidden lg:inline" /> Pacific Northwest sailing life.
            </h2>
            <HeroCarousel />
          </div>
        </div>
        {/* Flipped wave in Band A color cuts into the hero gradient itself. */}
        <WaveDivider flip className="absolute inset-x-0 bottom-0 text-[var(--smn-bg)]" />
      </section>

      {SHOW_LIVE_COUNTERS && <LiveNowWidget />}

      {/* Find your place — moved into the old "What is Sail More Now" slot; light
          grey band (smn-band-a) continuous with the grey the hero wave + SailFlow
          sit on, which also removes the old pale flat-topped band here. */}
      <section className="smn-band-a py-12 sm:py-16 lg:py-20" data-testid="find-your-place">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionEyebrow>Find your place</SectionEyebrow>
          <h2 className="font-display font-bold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight max-w-2xl">
            Pick the account that fits you.
          </h2>
          <div className="mt-6 flex flex-wrap gap-2.5" role="tablist">
            {ROLE_PATHS.map((p, i) => {
              const active = i === roleIdx;
              return (
                <button key={p.key} onClick={() => setRoleIdx(i)} data-testid={`role-pin-${p.key}`}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold border-2 transition-colors ${active ? "bg-[#1F3F5B] border-[#1F3F5B] text-white dark:bg-[#F2A03B] dark:border-[#F2A03B] dark:text-[#10233A]" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#55B3AD]"}`}>
                  <Icon name={p.icon} size={16} tone="current" /> {p.label}
                </button>
              );
            })}
          </div>

          <div className="mt-8 grid lg:grid-cols-2 gap-6" data-testid={`role-card-${role.key}`}>
            {/* Free / what you get */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-[var(--smn-bg)] dark:bg-slate-800 p-7">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-[#55B3AD]/15 flex items-center justify-center">
                  <Icon name={role.icon} size={24} tone="brand" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-xl smn-heading">{role.label}</h3>
                  <div className="text-sm font-semibold text-[#2A7871] dark:text-[#7fcac4]">{role.price}</div>
                </div>
              </div>
              <p className="mt-4 text-slate-600 dark:text-slate-300">{role.tagline}</p>
              <ul className="mt-5 space-y-2.5">
                {role.free.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm smn-heading font-medium">
                    <Icon name="success" tone="current" className="h-5 w-5 text-[#55B3AD] shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              {!role.partner && (
                <button onClick={() => handleLogin(clip)} data-testid={`role-join-${role.key}`}
                  className="mt-6 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold transition-colors">
                  Join as {role.label} <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                </button>
              )}
              {role.partner && (
                <Link to="/register?role=partner" data-testid="role-join-partner"
                  className="mt-6 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold transition-colors">
                  Join for free <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                </Link>
              )}
            </div>

            {/* Premium / Community Partner */}
            <div className="rounded-3xl border-2 border-[#F2A03B]/40 bg-[#F2A03B]/[0.06] dark:bg-[#F2A03B]/[0.08] p-7" data-testid={`role-premium-${role.key}`}>
              <div className="flex items-center gap-2 text-[#B45309] dark:text-[#F2A03B]">
                {role.partner ? <Icon name="award" tone="current" className="h-5 w-5" /> : <Icon name="rocket" tone="current" className="h-5 w-5" />}
                <span className="font-display font-bold text-lg">{role.premiumTitle}</span>
              </div>
              {role.premiumNote && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{role.premiumNote}</p>}
              <ul className="mt-5 space-y-2.5">
                {role.premium.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm smn-heading font-medium">
                    <Icon name="add" tone="current" className="h-5 w-5 text-[#F2A03B] shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              {role.partner ? (
                <button onClick={() => setInquiryOpen(true)} data-testid="partner-lets-chat-btn"
                  className="mt-6 inline-flex items-center gap-2 bg-[#1F3F5B] hover:bg-[#152a3d] dark:bg-[#F2A03B] dark:hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold transition-colors">
                  <Icon name="messages" size={16} tone="current" /> Let's Chat
                </button>
              ) : (
                <Link to="/pricing" data-testid={`role-plans-${role.key}`}
                  className="mt-6 inline-flex items-center gap-2 border-2 border-[#F2A03B] text-[#B45309] dark:text-[#F2A03B] hover:bg-[#F2A03B]/10 rounded-full px-6 py-3 font-semibold transition-colors">
                  See Premium plans <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Wave: Find your place (grey) -> Crew Bank (white) */}
      <Wave testId="wave-fyp-crew" fill="text-[var(--smn-bg)]" below="bg-white dark:bg-slate-900" />

      {/* Crew Bank - static visitor section (white band) */}
      <section className="bg-white dark:bg-slate-900 py-12 sm:py-16 lg:py-20" data-testid="crew-bank-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-[#2A7871] dark:text-[#7fcac4] flex items-center gap-2">
            <Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Seasonal and Per Event Crew Banks
          </div>
          <h2 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight max-w-2xl">Find crew for the season or just for the weekend</h2>
          <h3 className="font-display font-bold smn-heading text-xl sm:text-2xl mt-8">Why Use Our Crew Bank?</h3>
          <ul className="mt-5 grid sm:grid-cols-2 gap-x-8 gap-y-3 max-w-4xl">
            {[
              ["Precision Matching", "Filter crew members by exact experience levels and preferred positions."],
              ["Style Alignment", "Instantly see if someone prefers high-intensity racing or relaxed cruising."],
              ["Compatibility First", "View personality snapshots to ensure a harmonious environment on board."],
              ["Up-to-Date Schedules", "Check immediate and upcoming availability at a glance."],
            ].map(([label, text]) => (
              <li key={label} className="flex items-start gap-2.5 text-sm" data-testid={`crew-why-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`}>
                <Icon name="success" tone="current" className="h-5 w-5 text-[#55B3AD] shrink-0" />
                <span className="text-slate-600 dark:text-slate-300"><strong className="smn-heading font-bold">{label}:</strong> {text}</span>
              </li>
            ))}
          </ul>
          <Link to="/pricing" data-testid="crew-get-access-btn" className="mt-8 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 text-sm font-semibold transition-colors">
            Get access today <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Wave: Crew Bank (white) -> Word on the Dock (grey) */}
      <Wave testId="wave-crew-dock" fill="text-white dark:text-slate-900" below="bg-[var(--smn-bg)]" />

      {/* Word on the Dock - static visitor section (grey band) */}
      <section className="bg-[var(--smn-bg)] py-12 sm:py-16 lg:py-20" data-testid="word-on-dock-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionEyebrow>Word on the Dock</SectionEyebrow>
          <h2 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight">One hub for your local sailing market.</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">Skip the clutter of national forums, social media, and generic classified sites. Get hyper-local race info, crew finders, boat listings, and club news delivered straight to you.</p>
          <div className="mt-8 grid sm:grid-cols-2 gap-5">
            {[
              ["Posts", "Share Insights, Club updates, Sailing/Volunteer opportunities, etc with your local community"],
              ["Forum", "Pose questions, prompt conversations, engage directly with your own community members"],
              ["Blog", "Knowledgeable about a certain topic? Help others refine their skills to boost participation in sailing activities."],
              ["Marketplace", "Parts bin filling up? Need to sell your boat? Post where you know potential buyers are sailors."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-2xl bg-white dark:bg-slate-800 p-6 border border-slate-100 dark:border-slate-700 shadow-sm" data-testid={`dock-card-${title.toLowerCase()}`}>
                <h3 className="font-display font-bold smn-heading text-lg">{title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Wave: Word on the Dock (grey) -> Marine Service Directory (white) */}
      <Wave testId="wave-dock-directory" fill="text-[var(--smn-bg)]" below="bg-white dark:bg-slate-900" />

      <DirectoryPreview />

      {/* Wave: Marine Service Directory (white) -> CTA (navy) */}
      <Wave testId="wave-directory-cta" fill="text-white dark:text-slate-900" below="bg-[#17324a] dark:bg-[#020617]" />

      {/* CTA band — navy */}
      <section className="smn-hero text-white py-12 sm:py-16 lg:py-20" data-testid="cta-band">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl bg-white/5 border border-white/10 backdrop-blur p-6 sm:p-10 lg:p-14 grid md:grid-cols-2 gap-6 md:gap-8 items-center">
            <div>
              <h3 className="font-display font-extrabold text-2xl sm:text-3xl lg:text-4xl tracking-tight">Sailors, Clubs, and Boat Pros. All in one place.</h3>
              <p className="text-slate-200 mt-4 max-w-lg">Join your local sailing community in under a minute.</p>
              {SHOW_LIVE_COUNTERS && <CommunityStats />}
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <button
                onClick={() => handleLogin(clip)}
                data-testid="cta-signup-btn"
                className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold"
              >Sign up with Google</button>
              <Link to="/pricing" className="inline-flex items-center gap-2 border-2 border-white/40 hover:border-white text-white rounded-full px-6 py-3 font-semibold">See pricing</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Wave: CTA (navy) -> What sailors are saying (white) */}
      <Wave testId="wave-cta-testimonials" fill="text-[#17324a] dark:text-[#020617]" below="bg-white dark:bg-slate-900" />

      <TestimonialsStrip />

      {/* Wave: What sailors are saying (white) -> Founding Partners (navy) */}
      <Wave testId="wave-testimonials-founding" fill="text-white dark:text-slate-900" below="bg-[#1F3F5B]" />

      <FoundingWall />

      <PartnerInquiryModal open={inquiryOpen} onClose={() => setInquiryOpen(false)} />
    </div>
  );
}

function CommunityStats() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/stats/public").then(({ data }) => setS(data)).catch(() => {}); }, []);
  const cells = [
    { label: "Members", value: s?.members },
    { label: "Boat Pros", value: s?.boat_pros },
    { label: "Upcoming events", value: s?.upcoming_events },
    { label: "PNW markets", value: s?.markets },
  ];
  return (
    <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="engagement-bar">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-center">
          <div className="font-display font-extrabold text-2xl sm:text-3xl text-white tabular-nums" data-testid={`stat-${c.label.split(" ")[0].toLowerCase()}`}>
            {c.value == null ? " - " : c.value.toLocaleString()}
          </div>
          <div className="text-[11px] uppercase tracking-widest text-slate-300 mt-0.5">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function PartnerInquiryModal({ open, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", org: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email are required."); return; }
    setBusy(true);
    try {
      const message = `Community Partner inquiry.\nOrganization: ${form.org.trim() || " - "}\n\n${form.note.trim() || "Interested in becoming a Community Partner."}`;
      await api.post("/contact", { name: form.name.trim(), email: form.email.trim(), subject: "Community Partner inquiry", message });
      setSent(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send - please try again.");
    } finally { setBusy(false); }
  };

  const close = () => { setSent(false); setForm({ name: "", email: "", org: "", note: "" }); onClose(); };

  return (
    <Modal
      open={open}
      onClose={close}
      eyebrow={<><Icon name="award" tone="current" className="h-3.5 w-3.5" /> Community Partner</>}
      title="Become a Community Partner"
      testId="partner-inquiry-modal"
      footer={sent ? (
        <button onClick={close} data-testid="partner-inquiry-done" className="bg-[#1F3F5B] text-white rounded-full px-5 py-2 font-semibold">Done</button>
      ) : (
        <>
          <button onClick={close} className="text-slate-600 px-4 py-2 rounded-full hover:bg-slate-100">Cancel</button>
          <button onClick={submit} disabled={busy} data-testid="partner-inquiry-submit" className="bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50">
            {busy ? "Sending…" : "Send inquiry"}
          </button>
        </>
      )}
    >
      {sent ? (
        <div className="p-8 text-center" data-testid="partner-inquiry-sent">
          <Icon name="success" tone="current" className="h-12 w-12 text-[#55B3AD] mx-auto" />
          <p className="mt-3 font-display font-bold text-lg smn-heading">Thanks - we'll be in touch</p>
          <p className="text-sm text-slate-500 mt-1">Our team will reach out about becoming a Community Partner.</p>
        </div>
      ) : (
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600">Tell us about your club or organization and we'll set up a chat.</p>
          <input value={form.name} onChange={set("name")} placeholder="Your name" data-testid="partner-name-input" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <input value={form.email} onChange={set("email")} placeholder="Email" type="email" data-testid="partner-email-input" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <input value={form.org} onChange={set("org")} placeholder="Organization / club name" data-testid="partner-org-input" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <textarea rows={3} value={form.note} onChange={set("note")} placeholder="Anything you'd like us to know (optional)" data-testid="partner-note-input" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
        </div>
      )}
    </Modal>
  );
}
