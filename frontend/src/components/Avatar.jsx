import { useState } from "react";
import { BACKEND_URL } from "@/lib/api";

/**
 * Robust image renderer.
 *
 * - If `src` is an emoji / short string, renders it centered in a tinted container.
 * - If `src` looks like a URL, renders <img> with `object-cover` + `onError`
 *   fallback so a dead image URL never overflows the parent card.
 *
 * Shape is controlled via the `rounded` prop ("full" | "xl" | "lg" | "md" | "none").
 * Size is via `className` (e.g. "h-9 w-9").
 */
const ROUNDED = {
  full: "rounded-full",
  "3xl": "rounded-3xl",
  "2xl": "rounded-2xl",
  xl: "rounded-xl",
  lg: "rounded-lg",
  md: "rounded-md",
  none: "",
};

export default function Avatar({
  src,
  className = "h-9 w-9",
  rounded = "full",
  alt = "",
  fallback = "⛵",
  fallbackClassName = "text-lg",
  testId,
}) {
  const [failed, setFailed] = useState(false);
  // Avatars uploaded to object storage are stored as a relative "/api/files/..."
  // path so web + mobile render the same image via their own backend URL.
  const resolved = typeof src === "string" && src.startsWith("/api/") ? `${BACKEND_URL}${src}` : src;
  const isUrl = typeof resolved === "string" && /^(https?:\/\/|data:image\/)/i.test(resolved);
  // An ORG account's logo lives under the ".../org/..." storage path (personal
  // photos are ".../avatars/..."). Draw an org logo on a FIXED white circle
  // (theme-independent), matching LogoCircle, so a transparent PNG reads cleanly
  // in dark mode. Personal photos & initials fallbacks keep the teal tint.
  const isOrgLogo = isUrl && /\/org\//.test(resolved);
  const roundedCls = ROUNDED[rounded] ?? ROUNDED.full;
  const bgCls = isOrgLogo ? "bg-white" : "bg-[#55B3AD]/15";
  const wrap = `${className} ${roundedCls} ${bgCls} flex items-center justify-center overflow-hidden shrink-0`;

  if (!isUrl || failed) {
    // Only render `src` as a glyph when it's a short string (an emoji avatar).
    // A long non-URL value (e.g. raw base64 without a data: prefix) must NEVER
    // be printed as text, or it overflows the layout.
    const glyph = (typeof src === "string" && !isUrl && src.length <= 8 && src) || fallback;
    return (
      <div className={wrap} data-testid={testId} aria-label={alt}>
        <span className={`${fallbackClassName} leading-none select-none`}>{glyph}</span>
      </div>
    );
  }
  return (
    <div className={wrap} data-testid={testId}>
      <img
        src={resolved}
        alt={alt}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  );
}
