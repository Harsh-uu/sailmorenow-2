import axios from "axios";
import { toast } from "sonner";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Central paywall handler: a 402/403 {detail:{code:"upgrade_required"}} from any
// gated endpoint shows an upgrade toast linking to My plan (the request was
// authenticated, so the user is logged in), then rejects so the caller can stop.
api.interceptors.response.use(
  (r) => r,
  (e) => {
    const d = e?.response?.data?.detail;
    const st = e?.response?.status;
    if ((st === 402 || st === 403) && d && typeof d === "object" && d.code === "upgrade_required") {
      e.upgradeHandled = true;
      toast.error(d.message || "This is a Premium feature.", {
        action: { label: "See plan details", onClick: () => { window.location.href = "/my-plan"; } },
      });
    }
    // Normalize FastAPI error detail to a string so callers that render
    // `response.data.detail` (toast/inline) can never pass an object to React.
    if (e?.response?.data && d && typeof d !== "string") {
      if (Array.isArray(d)) e.response.data.detail = d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
      else if (typeof d === "object") e.response.data.detail = d.message || d.code || "Request failed";
    }
    return Promise.reject(e);
  }
);

export const LOGO_COLOR =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/lltelpvx_SMN_Logo_Horizontal.webp";
export const LOGO_MARK =
  "https://customer-assets.emergentagent.com/job_af65001a-b53f-4461-81c8-558b5fce7612/artifacts/4n64e6em_SMN_Logo2_NoTagline_Color_Transparent.webp";
export const LOGO_WHITE =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/8xa15w4k_SMN_Logo_Horizontal_DarkBG.webp";
export const LOGO_MARK_WHITE =
  "https://customer-assets.emergentagent.com/job_af65001a-b53f-4461-81c8-558b5fce7612/artifacts/mdrtjkh0_SMN_Logo2_NoTagline_AllWhite_Transparent.webp";

// Round brand mark (used on the Code of Conduct page). Not in the repo asset
// folders, so we point at the canonical WordPress copy.
export const LOGO_ROUND =
  "https://sailmorenow.com/wp-content/uploads/2026/09/cropped-smn_round_logo_transparent_200x200.png";

// External legal policies (hosted on Termly). Single source of truth so the
// URLs can be swapped later without touching every screen.
export const TERMS_URL =
  "https://app.termly.io/policy-viewer/policy.html?policyUUID=owsa-events-preview--7evdsk8f";
export const PRIVACY_URL =
  "https://app.termly.io/policy-viewer/policy.html?policyUUID=owsa-events-preview--7evdsk8f";

// Section / feature icons (used on landing pillars, badges, etc.)
export const ICON_BOAT_PROS =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/1jy6xdh9_SMN_Icon_BoatPros.png";
export const ICON_COMMUNITY =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/i56zbyln_SMN_Icon_Community.png";
export const ICON_CREW_OWNERS =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/r4ckvztm_SMN_Icon_CrewOwners.png";
export const ICON_VERIFIED =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/19nwli5u_SMN_Icon_Verified.png";

export const HERO_IMG =
  "https://images.unsplash.com/photo-1715885883010-9a04e71e236b?w=1600";
export const PRO_IMG =
  "https://customer-assets-cm19k8pv.emergentagent.net/job_437f721b-2788-4937-a9fb-57636aed9653/artifacts/997b405861cf899f_boat%20pros%20pic.JPG";
export const COMMUNITY_IMG =
  "https://customer-assets-cm19k8pv.emergentagent.net/job_437f721b-2788-4937-a9fb-57636aed9653/artifacts/0d4d71f6950748e2_community.webp";
export const EVENTS_IMG =
  "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/x1atucz0_IMG_7390.webp";

// Normalize FastAPI error details (string or 422 array) into a toast-safe string.
export const errMsg = (e, fallback = "Something went wrong") => {
  const d = e?.response?.data?.detail;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  if (typeof d === "object" && d.message) return d.message;
  return JSON.stringify(d);
};
