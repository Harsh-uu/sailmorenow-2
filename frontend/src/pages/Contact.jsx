import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { CONTACT_EMAIL, CONTACT_REGION } from "@/lib/contact";
import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const valid = form.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) && form.message.trim().length >= 10;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post("/contact", form);
      setSent(true); toast.success("Note sent — we'll be in touch.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to send"); }
    finally { setBusy(false); }
  };
  if (sent) return (
    <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-2xl p-6 text-center" data-testid="contact-form-sent">
      <div className="font-display font-bold text-lg smn-heading">Thanks — your note is in.</div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">We reply from {CONTACT_EMAIL}. Keep an eye on your inbox.</p>
    </div>
  );
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6" data-testid="contact-form">
      <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">Send us a note</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
               data-testid="contact-name" placeholder="Your name"
               className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
               data-testid="contact-email-input" placeholder="you@example.com"
               className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      </div>
      <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                data-testid="contact-message" rows={5} placeholder="What's on your mind? (at least 10 characters)"
                className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500 dark:text-slate-400">We read every note. Usually a same-day reply Mon-Fri.</p>
        <button onClick={submit} disabled={!valid || busy} data-testid="contact-submit"
                className="inline-flex items-center gap-1 bg-[#F2A03B] hover:bg-[#d9852b] disabled:opacity-40 text-white rounded-full px-5 py-2 font-semibold text-sm">
          <Icon name="send" tone="current" className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default function Contact() {
  return (
    <div data-testid="contact-page" className="bg-[var(--smn-bg)] dark:bg-slate-950">
      <section className="smn-hero text-white -mt-16 pt-24 sm:pt-28 pb-20">
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionEyebrow tone="white" className="!text-[#55B3AD] inline-flex items-center gap-2">
            <Icon name="anchor" tone="current" className="h-3.5 w-3.5" /> Say hello
          </SectionEyebrow>
          <h1 className="mt-3 font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-tight">
            Questions, ideas, or a<br/>Pacific Northwest race<br/>you think we should list?
          </h1>
          <p className="mt-6 text-slate-200 text-lg max-w-2xl">
            Sail More Now is built by a small crew here in the PNW. Send a note and a human will
            reply — usually the same day, always before the next Sunday digest.
          </p>
          <a href={`mailto:${CONTACT_EMAIL}`} data-testid="contact-hero-email"
             className="mt-8 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d9852b] text-white rounded-full px-6 py-3 font-semibold">
            <Icon name="mail" tone="current" className="h-4 w-4" /> {CONTACT_EMAIL}
          </a>
        </div>
      </section>

      <WaveDivider className="text-[#17324a] dark:text-slate-950" />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6" data-testid="contact-card-email">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 mb-3">
            <Icon name="mail" tone="current" className="h-5 w-5" />
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Email</div>
          <a href={`mailto:${CONTACT_EMAIL}`} className="mt-1 block font-display font-bold smn-heading hover:text-[#F2A03B]">
            {CONTACT_EMAIL}
          </a>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Feature requests, partner listings, press.</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6" data-testid="contact-card-region">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 mb-3">
            <Icon name="location" tone="current" className="h-5 w-5" />
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Region</div>
          <div className="mt-1 font-display font-bold smn-heading">{CONTACT_REGION}</div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Seattle · Portland · Bellingham · San Juans · beyond.</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6" data-testid="contact-card-hours">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 mb-3">
            <Icon name="clock" tone="current" className="h-5 w-5" />
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Reply hours</div>
          <div className="mt-1 font-display font-bold smn-heading">Mon – Fri, 9a – 5p PT</div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Weekend notes still get read — just a bit slower.</p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <ContactForm />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 text-center">
        <SectionEyebrow className="inline-block">Already a member?</SectionEyebrow>
        <h2 className="mt-2 font-display font-bold text-2xl smn-heading">
          Skip the email and message a Boat Pro directly.
        </h2>
        <Link to="/directory" data-testid="contact-directory-cta"
              className="mt-5 inline-flex items-center gap-2 bg-[#1F3F5B] dark:bg-[#F2A03B] hover:bg-[#152a3d] dark:hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold">
          Browse the directory
        </Link>
      </section>
    </div>
  );
}
