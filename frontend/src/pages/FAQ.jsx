import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, LOGO_ROUND } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const SUBJECTS = ["Billing", "Bug", "Feedback", "Other"];

function HelpMessageForm() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const guestValid = name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const valid = (user ? subject.trim().length > 0 : guestValid) && message.trim().length >= 10;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (user) {
        await api.post("/support/contact", { subject: subject.trim(), message: message.trim() });
      } else {
        await api.post("/contact", { name: name.trim(), email: email.trim(), message: subject.trim() ? `[${subject.trim()}] ${message.trim()}` : message.trim() });
      }
      setSent(true);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't send your message. Please try again."); }
    finally { setBusy(false); }
  };
  if (sent) return (
    <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-2xl p-6 text-center" data-testid="help-contact-sent">
      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center mb-3">
        <Icon name="check" tone="current" className="h-6 w-6 text-emerald-600" />
      </div>
      <p className="text-slate-700 dark:text-slate-200 font-medium">Thank you for contacting us. We will respond to your inquiry within 48 hours.</p>
    </div>
  );
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 p-6" data-testid="help-contact-form">
      <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">Send us a message</div>
      {user ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Sending as <b className="text-[#1F3F5B] dark:text-slate-100">{user.name}</b> ({user.email})</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="help-name" placeholder="Your name"
                 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="help-email" placeholder="you@example.com"
                 className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3" data-testid="help-subject-presets">
        {SUBJECTS.map((p) => (
          <button key={p} type="button" onClick={() => setSubject(p)} data-testid={`help-preset-${p.toLowerCase()}`}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${subject === p ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#55B3AD]"}`}>
            {p}
          </button>
        ))}
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="help-subject" placeholder="Subject" maxLength={120}
             className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} data-testid="help-message" rows={5}
                placeholder="How can we help? Share as much detail as you can…" maxLength={4000}
                className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm resize-none" />
      <button onClick={submit} disabled={!valid || busy} data-testid="help-submit"
              className="mt-3 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
        <Icon name="send" tone="current" className="h-4 w-4" /> {busy ? "Sending…" : "Send message"}
      </button>
    </div>
  );
}

function AccordionItem({ faq, open, onToggle, query }) {
  const highlight = (text) => {
    if (!query) return text;
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="bg-[#F2A03B]/30 rounded px-0.5">{text.slice(i, i + query.length)}</mark>
        {text.slice(i + query.length)}
      </>
    );
  };
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden bg-white dark:bg-slate-900" data-testid={`faq-item-${faq.id}`}>
      <button
        onClick={onToggle}
        data-testid={`faq-question-${faq.id}`}
        className="w-full flex items-center justify-between gap-4 text-left px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="font-semibold text-[#1F3F5B] dark:text-slate-100">{highlight(faq.question)}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} tone="current" className={`h-5 w-5 shrink-0 ${open ? "text-[#55B3AD]" : "text-slate-400"}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-slate-600 dark:text-slate-300 leading-relaxed" data-testid={`faq-answer-${faq.id}`}>
          {highlight(faq.answer)}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  const [faqs, setFaqs] = useState(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    api.get("/faqs").then(({ data }) => setFaqs(data)).catch(() => setFaqs([]));
  }, []);

  const grouped = useMemo(() => {
    if (!faqs) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
      : faqs;
    const byCat = new Map();
    filtered.forEach((f) => {
      if (!byCat.has(f.category)) byCat.set(f.category, { category: f.category, order: f.category_order ?? 99, items: [] });
      byCat.get(f.category).items.push(f);
    });
    return [...byCat.values()].sort((a, b) => a.order - b.order);
  }, [faqs, query]);

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center">
        <img src={LOGO_ROUND} alt="Sail More Now" data-testid="faq-logo" className="h-28 w-28 mx-auto mb-4 object-contain" />
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-[#1F3F5B] dark:text-slate-100">Help &amp; FAQ</h1>
        <p className="mt-3 text-slate-500 dark:text-slate-400">Answers to the questions sailors ask us most.</p>
      </div>

      <div className="mt-8 relative">
        <Icon name="search" tone="current" className="h-5 w-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpenId(null); }}
          placeholder="Search help articles…"
          data-testid="faq-search"
          className="w-full rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#55B3AD]"
        />
      </div>

      {faqs === null ? (
        <p className="text-center text-slate-400 mt-10">Loading…</p>
      ) : grouped.length === 0 ? (
        <p className="text-center text-slate-500 mt-10" data-testid="faq-empty">No articles match &ldquo;{query}&rdquo;. Try another search.</p>
      ) : (
        <div className="mt-8 space-y-8">
          {grouped.map((g) => (
            <section key={g.category} data-testid={`faq-category-${g.category}`}>
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD] mb-3">{g.category}</h2>
              <div className="space-y-3">
                {g.items.map((f) => (
                  <AccordionItem key={f.id} faq={f} open={openId === f.id || !!query} onToggle={() => toggle(f.id)} query={query.trim()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-12" data-testid="help-contact-section">
        <h2 className="text-center font-display font-bold text-xl text-[#1F3F5B] dark:text-slate-100 mb-4">Still stuck? Send us a message</h2>
        <HelpMessageForm />
      </div>
    </div>
  );
}
