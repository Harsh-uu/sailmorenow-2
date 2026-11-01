import { Link } from "react-router-dom";
import { LOGO_ROUND } from "@/lib/api";

// Code of Conduct content. The route stays /community-guidelines so existing
// links keep working, but every label now reads "Code of Conduct".
const COC = [
  { t: "lead", text: `The social contract for Trust, Community, and Verification across the Sail More Now community.` },
  { t: "p", text: `This Code of Conduct is the "social contract" of Sail More Now. It turns the platform's core values, Trust, Community, and Verification, into actionable rules for every member.` },
  { t: "p", text: `Purpose: To keep the Pacific Northwest sailing community a safe, respectful, and reliable place for boat owners, crew, clubs and organizations, and vendors alike. By using Sail More Now, you agree to the following:` },

  { t: "h2", text: `1. The Golden Rule of the Water (Safety First)` },
  { t: "ul", items: [
    `Captains: I agree to provide a safety briefing to all new crew, maintain essential safety gear (PFDs, flares, VHF), and never knowingly put crew in a position beyond their stated experience level.`,
    `Crew: I agree to follow the Skipper's instructions promptly, remain sober while underway, and alert the Skipper immediately to any safety concerns or equipment failures.`,
    `Vendors: I will perform all services to ABYC or industry standard safety levels.`,
    `Clubs & Organizations: I agree to accurately represent our safety standards, instructor certifications, and vetting practices for any courses, races, or crew opportunities we post through Sail More Now, and to require appropriate safety briefings for any event we host.`,
  ] },

  { t: "h2", text: `2. Radical Reliability` },
  { t: "ul", items: [
    `The "Dock Time" Promise: In sailing, timing often depends on tides and weather. I will communicate early and often. If I am Crew, I will not "no-show" for a departure. If I am an Owner, I will respect the Crew's time by giving ample notice of cancellations.`,
    `Accurate Representation: I will provide honest details about my experience, certifications (ASA/RYA, ABYC, etc.), and the condition of my vessel or business services.`,
    `Clubs & Organizations: I will honor posted event, course, and volunteer opportunity details, and give ample notice of cancellations or schedule changes for anything my club or organization lists through Sail More Now.`,
  ] },

  { t: "h2", text: `3. Integrity in the Review System` },
  { t: "p", text: `Reviews help our community find people and organizations they can trust. They only work if they are honest, fair and about real experiences.` },
  { t: "h3", text: `Who can review` },
  { t: "ul", items: [
    `Paid members can write reviews. Free accounts can browse reviews and respond to reviews about them, but cannot write one.`,
    `Sailors and owners can review Boat Pros and organizations. Owners and sailors can review each other. Boat Pros can review owners, sailors and organizations they have worked with. Community Partners and Founding Partners can review Boat Pros.`,
    `You cannot review yourself, and organizations cannot review other organizations.`,
    `Sailors can review other sailors, and owners can review other owners, when they have sailed together.`,
    `Boat Pro Reviews: a Boat Pro can review another Boat Pro only from their personal profile, only when they do not share a service category, and only once per pair. This protects the review system from conflicts of interest and tampering. Boat Pros remain eligible to receive reviews from the customers they serve.`,
    `Review only people and organizations you have actually worked with, hired, sailed with or used.`,
  ] },
  { t: "h3", text: `What a good review looks like` },
  { t: "ul", items: [
    `Honest Feedback: Stick to your own experience and facts. Say what happened.`,
    `Rate fairly. Overall is required. Personality, Skill, Promptness and Communication are optional; rate only what you can judge.`,
    `Professionalism: Keep it civil and constructive. No harassment, threats, hate speech, discrimination, or personal attacks.`,
    `Anti-Retaliation: I will not use the review system as a threat or for personal grievances.`,
    `No private information about anyone (phone numbers, addresses, medical or financial details).`,
    `No reviews written in exchange for payment, discounts or favors, and no reviews written to hurt a competitor or to promote yourself, a friend or your own business.`,
    `Do not post false or misleading statements, and do not accuse anyone of a crime.`,
  ] },
  { t: "h3", text: `How reviews go live` },
  { t: "ul", items: [
    `When you review a person or a Boat Pro, you confirm that you worked together or sailed together. Your review stays private at first. The other person cannot see your rating or comment yet.`,
    `The person you reviewed is notified and invited to review you back. We remind them on day 3 and day 6.`,
    `As soon as they review you back, both reviews go live together.`,
    `If no one reviews back, your review goes live on its own after 7 days. There is no way to block or hide an honest review.`,
    `You can edit or withdraw your review while it is still private. Editing does not restart the 7 days. Withdrawing tells the other person and ends the process.`,
    `Reviews of organizations are public as soon as they are posted.`,
    `If a published review breaks these rules, contact disputes@sailmorenow.com.`,
  ] },
  { t: "h3", text: `Reviewing back` },
  { t: "p", text: `Paid members can review the other person in return, which makes both reviews live right away. Free accounts cannot review back, but any review left for them still goes live after 7 days.` },
  { t: "h3", text: `How ratings are calculated` },
  { t: "p", text: `Averages include only reviews that are live. Private and withdrawn reviews are not counted.` },
  { t: "h3", text: `Reporting and removal` },
  { t: "p", text: `Report a review that breaks these rules to disputes@sailmorenow.com. Sail More Now may hide or remove a review that breaks these rules. Removed reviews are kept in our internal records.` },

  { t: "h2", text: `4. The "Trust Layer" Agreement` },
  { t: "ul", items: [
    `Privacy: I will respect the privacy of other members. I will not share boat locations, gate codes, or personal contact information obtained through Sail More Now with outside parties.`,
    `Event contact details: When I volunteer or register for an event, the host can see my name, email and phone number. Hosts will use this information only to coordinate that event and will not share it or use it for anything else.`,
    `Identity: I will use my own real identity, or, for a Club, Organization or Vendor, one I am authorized to represent. I will not allow anyone else to use my account to contact owners or vendors. Where Sail More Now offers identity verification, I will provide accurate information.`,
    `Eligibility: I confirm that I am at least 18 years of age. Sail More Now accounts, including accounts used to represent a Club, Organization, or Vendor, may only be created and managed by members who are 18 or older.`,
  ] },

  { t: "h2", text: `5. Community Stewardship` },
  { t: "ul", items: [
    `Inclusivity: Sail More Now is for everyone. I will not discriminate based on race, gender, age (for members 18 and older), or background.`,
    `Environmental Respect: I will follow "Clean Marina" best practices and respect the Salish Sea and PNW waterways by minimizing my environmental footprint.`,
  ] },

  { t: "h2", text: `6. Content & Community Standards` },
  { t: "p", text: `Sail More Now includes shared spaces built on trust: Crew Bank profiles, photos and videos, blog posts, the Community Feed, the Marketplace, Forums in the Hub, and Direct Messaging. These standards apply to all content and communication on the platform.` },
  { t: "ul", items: [
    `Photos & Videos: I will only post photos and videos that I personally took or have explicit permission to share. I will not post sexually explicit, graphic, or illegal content. I will not post an identifiable photo or video of another member without their consent.`,
    `Blogs & Posts: I will keep blog posts and Community Feed content relevant to sailing, sailing events, or the Sail More Now community. Clubs and Organizations may use the Community Feed to share events, volunteer opportunities, and updates, but not for advertising unrelated to an active Vendor or Community Partner listing, other than posting a vessel or boat-related gear for sale.`,
    `Crew Bank Entries: Crew Bank listings are for individual sailors and are created from a personal profile. Clubs, Organizations and Boat Pro business accounts do not list themselves in the Crew Bank. I will represent my experience, certifications, and availability honestly. I will not create duplicate, fraudulent, or misleading listings.`,
    `Marketplace: Marketplace posting is for paid members. I will describe items honestly, including condition and any known defects. I will post only items I own or am authorized to sell. I will not post fake listings, bait-and-switch offers, or offers I do not intend to honor. Marketplace is for vessels and boat-related gear.`,
    `Direct Messaging: I will use Direct Messaging for sailing-related engagement and coordination only. I will not harass, send unsolicited explicit content, or repeatedly contact a member who has asked me to stop.`,
    `Forums: I will participate in Forum discussions respectfully and on topic. I understand that Sail More Now, LLC and designated moderators may remove any post, photo, video, or message, and may restrict a member's posting privileges, for violations of this Code of Conduct.`,
  ] },

  { t: "h2", text: `7. Accountability & "One-Strike" Rule` },
  { t: "p", text: `To maintain the integrity of the Sail More Now community, we operate a strict Zero-Tolerance Policy for serious misconduct. We believe that trust is difficult to build but easy to lose.` },
  { t: "p", text: `One-Strike Violations: The following actions will result in an immediate and permanent ban from the platform, forfeiture of any remaining subscription balance, and removal of all "Verified" badges.` },
  { t: "ul", items: [
    `Safety Negligence: Knowingly operating a vessel in an unsafe manner or arriving for crew duties under the influence of drugs or alcohol.`,
    `Harassment & Discrimination: Any form of verbal, physical, or digital harassment, or discrimination based on race, gender, orientation, or background.`,
    `Fraudulent Identity: Providing falsified government IDs, fake certifications, misrepresenting vessel ownership, or misrepresenting a Club or Organization's affiliation or standing.`,
    `Content & Communication Abuse: Posting sexually explicit, illegal, or exploitative content, or persistent misuse of Direct Messaging, Crew Bank listings, the Marketplace, or the Forums for harassment, spam, or fraud.`,
  ] },
  { t: "p", text: `Progressive Enforcement for Other Violations: Not every violation of this Code of Conduct is a One-Strike offense. For lesser or first-time guideline violations, Sail More Now uses a graduated moderation process before any permanent action is taken. For example, a member's posting access may first be restricted by flagging their posts for moderator approval. This restriction is meant to be temporary and will be lifted when the moderators feel the situation has been resolved. If a member cannot follow the guidelines after that, their account will be blocked from posting. Further actions, such as restricting access to the Services as a whole, can and will be applied if necessary.` },
  { t: "p", text: `The Right to Remove: Sail More Now, LLC reserves the sole right to determine what constitutes misconduct. Our "One-Strike" policy is in place to protect the 99% of our community who sail with integrity from the 1% who do not.` },
  { t: "applies", text: `Applies to: Boat Owners, Sailors/Crew, Boat Pros (Vendors), Clubs & Organizations.` },
];

export default function CommunityGuidelines() {
  const toc = COC.filter((b) => b.t === "h2");
  const secId = (text) => `sec-${parseInt(text, 10)}`;
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Insert a "Back to top" marker at the end of every section.
  const rendered = [];
  let seenH2 = false;
  COC.forEach((b) => {
    if (b.t === "h2") {
      if (seenH2) rendered.push({ t: "backtotop" });
      seenH2 = true;
    }
    rendered.push(b);
  });
  rendered.push({ t: "backtotop" });

  return (
    <div className="bg-white dark:bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16" data-testid="community-guidelines-page">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm flex items-center justify-center overflow-hidden">
            <img src={LOGO_ROUND} alt="Sail More Now logo" className="h-16 w-16 object-contain rounded-full" data-testid="coc-logo" />
          </div>
          <h1 className="mt-4 font-display font-extrabold text-3xl sm:text-4xl text-[#1F3F5B] dark:text-slate-100">Code of Conduct</h1>
        </div>

        <nav className="mt-8 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-5" data-testid="coc-toc" aria-label="Contents">
          <p className="font-display font-bold text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">Contents</p>
          <ol className="mt-3 space-y-2">
            {toc.map((b, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => scrollTo(secId(b.text))}
                  className="text-left text-[#2A7871] dark:text-[#7cc] hover:underline"
                  data-testid={`coc-toc-${parseInt(b.text, 10)}`}
                >
                  {b.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 break-words">
          {rendered.map((b, i) => {
            if (b.t === "lead") return <p key={i} className="text-base italic text-slate-500 dark:text-slate-400">{b.text}</p>;
            if (b.t === "h2") return <h2 key={i} id={secId(b.text)} className="scroll-mt-28 pt-5 font-display font-bold text-xl sm:text-2xl text-[#1F3F5B] dark:text-slate-100">{b.text}</h2>;
            if (b.t === "h3") return <h3 key={i} className="pt-3 font-semibold text-lg text-[#2A7871] dark:text-[#7cc]">{b.text}</h3>;
            if (b.t === "ul") return <ul key={i} className="list-disc pl-6 space-y-2 marker:text-[#55B3AD]">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
            if (b.t === "applies") return <p key={i} className="pt-4 font-semibold text-slate-800 dark:text-slate-200">{b.text}</p>;
            if (b.t === "backtotop") return <button key={i} type="button" onClick={toTop} className="block pt-1 text-sm text-[#55B3AD] hover:underline">Back to top</button>;
            return <p key={i}>{b.text}</p>;
          })}
          <p className="pt-6 text-sm text-slate-400 dark:text-slate-500" data-testid="coc-last-updated">Last updated October 17, 2026</p>
        </div>

        <Link to="/" className="mt-10 inline-block text-[#55B3AD] font-semibold hover:underline">Back to home</Link>
      </div>
    </div>
  );
}
