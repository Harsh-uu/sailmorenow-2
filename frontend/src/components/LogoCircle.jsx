import { useState } from "react";
import { BACKEND_URL } from "@/lib/api";

/**
 * Shared circular logo. Single source of truth for how an org logo displays
 * everywhere (editor preview, public page, Clubs cards, lists): a perfect
 * circle, overflow hidden, image fills it with object-fit cover. A FIXED white
 * background (theme-independent) sits behind the image so transparent PNG logos
 * show white in both light and dark mode. The stored PNG stays transparent.
 */
export default function LogoCircle({ src, size = "h-14 w-14", alt = "", fallback = null, testId, className = "" }) {
  const [failed, setFailed] = useState(false);
  const resolved = typeof src === "string" && src.startsWith("/api/") ? `${BACKEND_URL}${src}` : src;
  const isUrl = typeof resolved === "string" && /^(https?:\/\/|data:image\/)/i.test(resolved);
  const wrap = `${size} ${className} rounded-full overflow-hidden shrink-0 flex items-center justify-center`;
  if (!isUrl || failed) {
    return <div className={wrap} data-testid={testId} aria-label={alt}>{fallback}</div>;
  }
  return (
    <div className={`${wrap} bg-white`} data-testid={testId}>
      <img src={resolved} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}
