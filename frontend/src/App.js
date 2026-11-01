import { BrowserRouter, Routes, Route, useLocation, useNavigationType, Navigate, Outlet } from "react-router-dom";
import "@/App.css";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WebSocketProvider } from "@/context/WebSocketContext";
import { MarketProvider } from "@/context/MarketContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Toaster } from "sonner";
import { Icon } from "@/components/Icon";
import Header from "@/components/Header";
import HandleConfirmPrompt from "@/components/HandleConfirmPrompt";
import Footer from "@/components/Footer";
import Landing from "@/pages/Landing";
import AuthCallback from "@/pages/AuthCallback";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import Directory from "@/pages/Directory";
import DirectoryDetail from "@/pages/DirectoryDetail";
import Clubs from "@/pages/Clubs";
import Events from "@/pages/Events";
import MyEvents from "@/pages/MyEvents";
import PartnerEvents from "@/pages/PartnerEvents";
import Messages from "@/pages/Messages";
import Pricing from "@/pages/Pricing";
import PaymentSuccess from "@/pages/PaymentSuccess";
import VerificationReturn from "@/pages/VerificationReturn";
import CommunityGuidelines from "@/pages/CommunityGuidelines";
import Profile from "@/pages/Profile";
import OrgListing from "@/pages/OrgListing";
import CrewBank from "@/pages/CrewBank";
import MyCrewListings from "@/pages/MyCrewListings";
import Reviews from "@/pages/Reviews";
import DigestPreview from "@/pages/DigestPreview";
import AdminEvents from "@/pages/AdminEvents";
import AdminHome from "@/pages/AdminHome";
import AdminAccess from "@/pages/AdminAccess";
import AdminVerifyUser from "@/pages/AdminVerifyUser";
import VerifyEmail from "@/pages/VerifyEmail";
import { VerifyBanner, VerifyLocked } from "@/components/VerifyUI";
import AdminEventSources from "@/pages/AdminEventSources";
import AdminReports from "@/pages/AdminReports";
import AdminModeration from "@/pages/AdminModeration";
import AdminAnalytics from "@/pages/AdminAnalytics";
import AdminContact from "@/pages/AdminContact";
import AdminEmailDelivery from "@/pages/AdminEmailDelivery";
import AdminComps from "@/pages/AdminComps";
import AdminBilling from "@/pages/AdminBilling";
import AdminSponsors from "@/pages/AdminSponsors";
import AdminPartners from "@/pages/AdminPartners";
import FollowingList from "@/pages/FollowingList";
import AdminReferrals from "@/pages/AdminReferrals";
import AdminZoho from "@/pages/AdminZoho";
import MyListing from "@/pages/MyListing";
import MyPlan from "@/pages/MyPlan";
import BoatProListing from "@/pages/BoatProListing";
import Contact from "@/pages/Contact";
import HandleProfile from "@/pages/HandleProfile";
import Community from "@/pages/Community";
import EditPost from "@/pages/EditPost";
import DiscussionDetail from "@/pages/DiscussionDetail";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import FAQ from "@/pages/FAQ";
import DemoData from "@/pages/DemoData";
import { RequireAuth } from "@/components/AuthGate";
import { DemoTourProvider } from "@/components/DemoTour";
import DevIcons from "@/pages/DevIcons";
import A11yContrastOverlay from "@/components/A11yContrastOverlay";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";

// React Router 7 does not support partial-segment dynamic params, so a
// literal '@' prefix in the path pattern makes /@:handle unmatchable.
// This wrapper catches any single-segment path and, if it starts with '@',
// renders <HandleProfile /> (which already strips the leading '@'); anything
// else redirects to the homepage so we don't shadow a missing static route.
function HandleAtAlias() {
  const { atHandle } = useParams();
  if (atHandle && atHandle.startsWith("@")) return <HandleProfile />;
  return <Navigate to="/" replace />;
}

// Seed once on first load if no data
function SeedOnBoot() {
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/boat-pros");
        if (!Array.isArray(data) || data.length === 0) await api.post("/seed");
      } catch {}
    })();
  }, []);
  return null;
}

function Shell() {
  const { user } = useAuth();
  const location = useLocation();
  const locked = user?.verification?.locked && location.pathname !== "/verify-email";
  return (
    <>
      <Header />
      <VerifyBanner />
      <main className="min-h-[60vh]">{locked ? <VerifyLocked /> : <Outlet />}</main>
      <Footer />
      <HandleConfirmPrompt />
    </>
  );
}

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/community" replace /> : <Landing />;
}

function AppRouter() {
  const location = useLocation();
  const navType = useNavigationType();
  // Scroll new pages to the top on real navigation (pathname change). Same-page
  // changes (tabs/filters/query strings only touch search/hash) are untouched;
  // Back/Forward (POP) is left to the browser's own scroll restoration.
  useEffect(() => {
    if (navType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navType]);
  // Detect OAuth callback synchronously
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/register" element={<Login />} />
        <Route path="/directory" element={<Directory />} />
        <Route path="/directory/:id" element={<DirectoryDetail />} />
        <Route path="/clubs" element={<Clubs />} />
        <Route path="/feed" element={<Navigate to="/community" replace />} />
        <Route path="/community" element={<RequireAuth feature="see the full community feed"><Community /></RequireAuth>} />
        <Route path="/community/listing/:id/edit" element={<RequireAuth feature="edit your listing"><EditPost /></RequireAuth>} />
        <Route path="/events" element={<RequireAuth feature="see the full events calendar and RSVP"><Events /></RequireAuth>} />
        <Route path="/my-events" element={<RequireAuth feature="manage your events"><MyEvents /></RequireAuth>} />
        <Route path="/partners/:handle" element={<RequireAuth feature="view this organization's page"><PartnerEvents /></RequireAuth>} />
        <Route path="/crew-bank" element={<RequireAuth feature="use the Crew Bank"><CrewBank /></RequireAuth>} />
        <Route path="/my-crew-listings" element={<RequireAuth feature="manage your crew listings"><MyCrewListings /></RequireAuth>} />
        <Route path="/reviews" element={<RequireAuth feature="see community reviews"><Reviews /></RequireAuth>} />
        <Route path="/digest" element={<DigestPreview />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/access" element={<AdminAccess />} />
        <Route path="/admin/verify-user" element={<AdminVerifyUser />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/admin/events" element={<AdminEvents />} />
        <Route path="/admin/event-sources" element={<AdminEventSources />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/moderation" element={<AdminModeration />} />
        <Route path="/admin/analytics" element={<AdminAnalytics />} />
        <Route path="/admin/contact" element={<AdminContact />} />
        <Route path="/admin/email" element={<AdminEmailDelivery />} />
        <Route path="/admin/comps" element={<AdminComps />} />
        <Route path="/admin/billing" element={<AdminBilling />} />
        <Route path="/admin/partners" element={<AdminPartners />} />
        <Route path="/following" element={<RequireAuth feature="manage who you follow"><FollowingList /></RequireAuth>} />
        <Route path="/admin/referrals" element={<AdminReferrals />} />
        <Route path="/admin/zoho" element={<AdminZoho />} />
        <Route path="/admin/demo" element={<DemoData />} />
        <Route path="/my-listing" element={<RequireAuth feature="manage your Boat Pro listing"><MyListing /></RequireAuth>} />
        <Route path="/boat-pro-listing" element={<RequireAuth feature="edit your Boat Pro listing"><BoatProListing /></RequireAuth>} />
        <Route path="/my-plan" element={<RequireAuth feature="see your plan"><MyPlan /></RequireAuth>} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/u/:handle" element={<HandleProfile />} />
        <Route path="/community-hub" element={<Navigate to="/community?tab=blog" replace />} />
        <Route path="/community-hub/:id" element={<RequireAuth feature="read the full discussion"><DiscussionDetail /></RequireAuth>} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/verify/return" element={<VerificationReturn />} />
        <Route path="/community-guidelines" element={<CommunityGuidelines />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<RequireAuth feature="open your dashboard"><Dashboard /></RequireAuth>} />
        <Route path="/messages" element={<RequireAuth feature="use direct messaging"><Messages /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth feature="view your profile"><Profile /></RequireAuth>} />
        <Route path="/org-listing" element={<RequireAuth feature="edit your directory listing"><OrgListing /></RequireAuth>} />
        {process.env.NODE_ENV === "development" && <Route path="/dev/icons" element={<DevIcons />} />}
        <Route path="/:atHandle" element={<HandleAtAlias />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <WebSocketProvider>
              <MarketProvider>
                <DemoTourProvider>
                  <SeedOnBoot />
                  <AppRouter />
                </DemoTourProvider>
                <Toaster
                  position="top-center"
                  richColors
                  offset={80}
                  icons={{
                    success: <Icon name="success" size={18} tone="current" />,
                    error: <Icon name="error" size={18} tone="current" />,
                    info: <Icon name="info" size={18} tone="current" />,
                    warning: <Icon name="warning" size={18} tone="current" />,
                  }}
                />
                {process.env.NODE_ENV === "development" && <A11yContrastOverlay />}
              </MarketProvider>
            </WebSocketProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </div>
  );
}
