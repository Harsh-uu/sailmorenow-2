import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import { useTheme } from "@/context/ThemeContext";
import { LOGO_COLOR, LOGO_WHITE } from "@/lib/api";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import NotificationsBell from "@/components/NotificationsBell";
import TopSearch from "@/components/TopSearch";
import Avatar from "@/components/Avatar";
import ThemeToggle from "@/components/ThemeToggle";
import ShareButton from "@/components/ShareButton";

const navLinks = [
  { to: "/directory", label: "Boat Pros" },
  { to: "/clubs", label: "Clubs & Orgs" },
  { to: "/community", label: "Hub" },
  { to: "/events", label: "Events" },
  { to: "/crew-bank", label: "Crew Bank" },
  { to: "/reviews", label: "Reviews", authOnly: true },
  { to: "/digest", label: "Digest", authOnly: true },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "Help" },
];

export default function Header() {
  const { user, logout, setActiveIdentity } = useAuth();
  const { market, setMarket } = useMarket();
  const { theme } = useTheme();
  const [markets, setMarkets] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [adminAlerts, setAdminAlerts] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.platform_role !== "admin") { setAdminAlerts(0); return; }
    let alive = true;
    const fetchAlerts = () => api.get("/admin/email-failures/summary")
      .then(({ data }) => { if (alive) setAdminAlerts(data?.unresolved || 0); })
      .catch(() => {});
    fetchAlerts();
    const t = setInterval(fetchAlerts, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  const switchIdentity = async (identity) => {
    if (switching || (user?.active_identity || "personal") === identity) { setAcctOpen(false); return; }
    setSwitching(true);
    try { await setActiveIdentity(identity); }
    catch { /* ignore */ }
    finally { setSwitching(false); setAcctOpen(false); }
  };

  // Route-based transparency: only the landing page opens with a
  // transparent header over the dark hero. Every other route stays solid so
  // dense app pages don't lose their nav under scroll.
  const isLanding = location.pathname === "/";
  const transparent = isLanding && !scrolled;

  useEffect(() => {
    api.get("/markets").then(({ data }) => setMarkets(data.markets)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isLanding) { setScrolled(true); return; }
    setScrolled(window.scrollY > 40);
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isLanding]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [drawerOpen]);

  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  // Logged-in users manage their plan; "Pricing" becomes "My plan" (/my-plan)
  // for every account type and tier. Logged-out visitors keep "Pricing".
  const visibleLinks = navLinks
    .filter((l) => !l.authOnly || user)
    .map((l) => (l.to === "/pricing" && user ? { ...l, to: "/my-plan", label: "My plan" } : l));

  // Transparent-over-hero uses the dark-BG logo (white text) so it reads on
  // the navy hero; solid header uses the color logo in light mode and the
  // dark-BG logo in dark mode.
  const logoSrc = transparent
    ? LOGO_WHITE
    : theme === "dark"
    ? LOGO_WHITE
    : LOGO_COLOR;

  const shellClass = transparent
    ? "bg-transparent border-b border-white/10"
    : "backdrop-blur-xl bg-white/85 dark:bg-slate-950/85 border-b border-slate-200 dark:border-slate-800";
  const linkBase = transparent
    ? "text-white/90 hover:text-white"
    : "text-slate-600 dark:text-slate-300 hover:text-[#1F3F5B] dark:hover:text-white";
  const linkActive = transparent
    ? "bg-white/15 text-white"
    : "bg-slate-100 dark:bg-slate-800 smn-heading";
  const iconBtn = transparent
    ? "text-white hover:bg-white/10"
    : "text-[#1F3F5B] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800";

  return (
    <header
      data-testid="app-header"
      data-transparent={transparent ? "true" : "false"}
      className={`sticky top-0 z-50 transition-colors duration-200 ${shellClass}`}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="mobile-menu-btn"
          className={`2xl:hidden p-2 -ml-2 rounded-full ${iconBtn}`}
          aria-label="Open menu"
        >
          <Icon name="menu" size={20} tone="current" />
        </button>

        <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2 shrink-0" data-testid="brand-link" aria-label="Sail More Now — home">
          <img src={logoSrc} alt="Sail More Now" data-testid="brand-logo" className="h-9 w-auto object-contain" />
        </Link>

        <nav className="hidden 2xl:flex items-center gap-1">
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              data-testid={`nav-${l.label.toLowerCase()}`}
              className={({ isActive }) =>
                `px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? linkActive : linkBase
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {user?.platform_role === "admin" && (
            <NavLink
              to="/admin"
              data-testid="nav-admin"
              className={({ isActive }) =>
                `ml-1 px-3 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1 ${
                  transparent
                    ? "text-orange-200 hover:bg-white/10"
                    : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                } ${isActive ? "bg-red-50 dark:bg-red-950/40" : ""}`
              }
            >
              Admin
              {adminAlerts > 0 && (
                <span data-testid="nav-admin-badge"
                  className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
                  {adminAlerts > 99 ? "99+" : adminAlerts}
                </span>
              )}
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          <div className={`hidden lg:flex items-center gap-2 rounded-full pl-3 pr-1 py-1 ${transparent ? "bg-white/15 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"}`}>
            <Icon name="anchor" tone="current" className="h-4 w-4 text-[#55B3AD]" />
            <select
              data-testid="market-selector"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="bg-transparent text-sm py-1 pr-2 focus:outline-none max-w-[180px] font-medium"
            >
              <option value="all">All markets</option>
              {markets.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          </div>

          <ThemeToggle variant={transparent ? "on-dark" : "auto"} data-testid-suffix="desktop" />

          {user ? (
            <>
              <TopSearch />
              <NotificationsBell />
              <ShareButton
                path="/"
                title="Sail More Now"
                text={`${user.name?.split(" ")[0] || "A friend"} thinks you'd love Sail More Now — the PNW sailing community hub.`}
                iconName="user-plus"
                iconOnly
                testId="refer-friend-btn"
                className={`hidden sm:inline-flex p-2 rounded-full ${iconBtn}`}
              />
              <button
                onClick={() => navigate("/messages")}
                data-testid="messages-btn"
                className={`hidden sm:inline-flex p-2 rounded-full ${iconBtn}`}
                title="Messages"
              >
                <Icon name="messages" size={20} tone="current" />
              </button>
              <div className="relative">
                <button
                  onClick={() => (user.can_use_business ? setAcctOpen((o) => !o) : navigate("/profile"))}
                  data-testid="profile-btn"
                  aria-haspopup={user.can_use_business ? "menu" : undefined}
                  aria-expanded={user.can_use_business ? acctOpen : undefined}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${transparent ? "hover:bg-white/10" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                >
                  {user.active_identity === "business" ? (
                    user.business_logo ? (
                      <Avatar src={user.business_logo} className="h-7 w-7" alt={user.business_name || "Your business"} fallback={<Icon name="anchor" size={16} tone="current" />} />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-white flex items-center justify-center text-sm font-bold text-[#1F3F5B]">{(user.business_name?.[0] || "B").toUpperCase()}</div>
                    )
                  ) : user.picture || user.avatar ? (
                    <Avatar src={user.picture || user.avatar} className="h-7 w-7" alt={user.name ? `${user.name}'s profile photo` : "Your account"} fallback={<Icon name="profile" size={16} tone="current" />} />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-[#55B3AD]/20 text-[#1F3F5B] dark:text-slate-100 flex items-center justify-center text-sm">
                      <Icon name="profile" size={16} tone="current" />
                    </div>
                  )}
                  <span className={`hidden sm:inline text-sm font-medium ${transparent ? "text-white" : "text-slate-700 dark:text-slate-200"}`}>
                    {user.active_identity === "business" ? (user.business_name || "Business") : user.name?.split(" ")[0]}
                  </span>
                  {user.can_use_business && <Icon name="chevron-down" size={14} tone="current" className={transparent ? "text-white/80" : "text-slate-400"} />}
                </button>
                {user.can_use_business && acctOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAcctOpen(false)} data-testid="acct-menu-backdrop" />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-lg overflow-hidden min-w-[240px]" data-testid="acct-menu" role="menu">
                      <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Acting as</div>
                      <button onClick={() => switchIdentity("personal")} data-testid="acting-as-personal" role="menuitemradio" aria-checked={user.active_identity !== "business"}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                        <Avatar src={user.picture || user.avatar} className="h-8 w-8" alt="You" fallback={<Icon name="profile" size={16} tone="current" />} />
                        <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">You</span>
                        {user.active_identity !== "business" && <Icon name="check" size={16} tone="current" className="text-[#55B3AD]" />}
                      </button>
                      <button onClick={() => switchIdentity("business")} data-testid="acting-as-business" role="menuitemradio" aria-checked={user.active_identity === "business"}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                        {user.business_logo
                          ? <Avatar src={user.business_logo} className="h-8 w-8" alt={user.business_name || "Business"} />
                          : <div className="h-8 w-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-sm font-bold text-[#1F3F5B]">{(user.business_name?.[0] || "B").toUpperCase()}</div>}
                        <span className="flex-1 min-w-0 text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{user.business_name || "Your business"}</span>
                        {user.active_identity === "business" && <Icon name="check" size={16} tone="current" className="text-[#55B3AD]" />}
                      </button>
                      <div className="border-t border-slate-100 dark:border-slate-800">
                        <button onClick={() => { setAcctOpen(false); navigate("/my-plan"); }} data-testid="acct-menu-my-plan"
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <Icon name="rocket" size={16} tone="current" /> My plan
                        </button>
                        <button onClick={() => { setAcctOpen(false); navigate("/profile"); }} data-testid="acct-menu-profile"
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <Icon name="profile" size={16} tone="current" /> View profile
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={logout}
                data-testid="logout-btn"
                className={`hidden sm:inline-flex p-2 rounded-full ${transparent ? "text-white/80 hover:bg-white/10" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                title="Log out"
              >
                <Icon name="logout" size={20} tone="current" />
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate("/login")}
              data-testid="login-btn"
              className={`transition-colors rounded-full px-5 py-2 text-sm font-semibold ${transparent ? "bg-white text-[#1F3F5B] hover:bg-white/90" : "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white hover:bg-[#152a3d] dark:hover:bg-[#d98c30]"}`}
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Mobile drawer — portaled to <body> so the header's backdrop-blur
          doesn't trap `fixed inset-0` inside the 64px header box. */}
      {drawerOpen && createPortal(
        <div className="2xl:hidden fixed inset-0 z-[60] bg-slate-900/60" onClick={() => setDrawerOpen(false)} data-testid="mobile-drawer-backdrop">
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
            data-testid="mobile-drawer"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <img src={theme === "dark" ? LOGO_WHITE : LOGO_COLOR} alt="Sail More Now" className="h-8 w-auto object-contain" />
              <button onClick={() => setDrawerOpen(false)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" data-testid="mobile-drawer-close">
                <Icon name="close" size={20} tone="muted" />
              </button>
            </div>
            <div className="lg:hidden px-4 pt-3 pb-1" data-testid="mobile-market-row">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Market</label>
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-full pl-3 pr-1 py-1">
                <Icon name="anchor" tone="current" className="h-4 w-4 text-[#55B3AD]" />
                <select
                  data-testid="mobile-market-selector"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  className="bg-transparent text-sm py-1 pr-2 focus:outline-none flex-1 font-medium text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All markets</option>
                  {markets.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </div>
            </div>
            <nav className="p-2 flex-1 overflow-y-auto">
              {visibleLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setDrawerOpen(false)}
                  data-testid={`mobile-nav-${l.label.toLowerCase()}`}
                  className={({ isActive }) =>
                    `block px-4 py-3 rounded-xl text-base font-medium ${
                      isActive ? "bg-slate-100 dark:bg-slate-800 smn-heading" : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              {user?.platform_role === "admin" && (
                <NavLink
                  to="/admin"
                  onClick={() => setDrawerOpen(false)}
                  data-testid="mobile-nav-admin"
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-base font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Admin
                  {adminAlerts > 0 && (
                    <span data-testid="mobile-nav-admin-badge"
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
                      {adminAlerts > 99 ? "99+" : adminAlerts}
                    </span>
                  )}
                </NavLink>
              )}
            </nav>
            {user && (
              <div className="px-2 pb-1">
                <NavLink
                  to="/my-plan"
                  onClick={() => setDrawerOpen(false)}
                  data-testid="mobile-nav-my-plan"
                  className="w-full inline-flex items-center gap-2 px-4 py-3 rounded-xl text-base font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Icon name="rocket" size={20} tone="current" /> My plan
                </NavLink>
                <ShareButton
                  path="/"
                  title="Sail More Now"
                  text={`${user.name?.split(" ")[0] || "A friend"} thinks you'd love Sail More Now — the PNW sailing community hub.`}
                  iconName="user-plus"
                  label="Invite a friend"
                  testId="mobile-refer-friend-btn"
                  className="w-full inline-flex items-center gap-2 px-4 py-3 rounded-xl text-base font-medium text-[#1F3F5B] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                />
                <button
                  onClick={() => { setDrawerOpen(false); logout(); }}
                  data-testid="mobile-logout-btn"
                  className="w-full inline-flex items-center gap-2 px-4 py-3 rounded-xl text-base font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Icon name="logout" size={20} tone="current" /> Log out
                </button>
              </div>
            )}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <ThemeToggle testId="theme-toggle-mobile" />
            </div>
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
}
