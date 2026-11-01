import { LOGO_WHITE, TERMS_URL, PRIVACY_URL } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { CONTACT_EMAIL, CONTACT_REGION } from "@/lib/contact";
import { Link, useLocation } from "react-router-dom";

export default function Footer() {
  const { pathname } = useLocation();
  return (
    <footer className={`bg-[#1F3F5B] text-slate-100 ${pathname === "/" ? "" : "mt-24"}`} data-testid="app-footer">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid md:grid-cols-4 gap-8">
        <div>
          <img src={LOGO_WHITE} alt="Sail More Now" className="h-14 w-auto object-contain" data-testid="footer-logo" />
          <p className="mt-4 text-sm text-slate-200 max-w-xs">
            The community hub for PNW sailing.
          </p>
          <div className="mt-5 flex items-center gap-3" data-testid="footer-socials">
            {[
              { name: "instagram", label: "Instagram", href: "https://www.instagram.com/sailmorenow" },
              { name: "facebook", label: "Facebook", href: "https://www.facebook.com/sailmorenow" },
              { name: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/sail-more-now" },
            ].map((s) => (
              <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer"
                 aria-label={s.label} data-testid={`footer-social-${s.name}`}
                 className="h-9 w-9 rounded-full bg-white/10 hover:bg-[#F2A03B] flex items-center justify-center transition-colors">
                <Icon name={s.name} tone="current" className="h-4 w-4 text-white" />
              </a>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#7fcac4] mb-3">Hub</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/feed" className="hover:text-[#F2A03B]">Community feed</Link></li>
            <li><Link to="/events" className="hover:text-[#F2A03B]">Events calendar</Link></li>
            <li><Link to="/directory" className="hover:text-[#F2A03B]">Boat Pro directory</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#7fcac4] mb-3">Grow</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/pricing" className="hover:text-[#F2A03B]">Boat Pro plans</Link></li>
            <li><Link to="/pricing" className="hover:text-[#F2A03B]">Sailor Premium</Link></li>
            <li><Link to="/faq" className="hover:text-[#F2A03B]" data-testid="footer-faq-link">Help &amp; FAQ</Link></li>
            <li><a href="https://sailmorenow.com" className="hover:text-[#F2A03B]">Main site</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#7fcac4] mb-3">Contact</div>
          <p className="text-sm text-slate-200" data-testid="footer-contact-region">{CONTACT_REGION}</p>
          <p className="text-sm text-slate-200" data-testid="footer-contact-email">
            <Link to="/contact" className="hover:text-[#F2A03B]">{CONTACT_EMAIL}</Link>
          </p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-xs text-slate-300 flex flex-col sm:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} Sail More Now. All rights reserved.</span>
          <Link to="/community-guidelines" className="hover:text-[#F2A03B]" data-testid="footer-coc-link">Code of Conduct</Link>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#F2A03B]" data-testid="footer-terms-link">Terms and Conditions</a>
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#F2A03B]" data-testid="footer-privacy-link">Privacy Policy</a>
          <span>More time on the water starts here.</span>
        </div>
      </div>
    </footer>
  );
}
