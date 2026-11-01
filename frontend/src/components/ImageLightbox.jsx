import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { BACKEND_URL } from "@/lib/api";

/**
 * Shared full-size image viewer. Shows the saved image (what visitors see,
 * larger), with close (button + Escape + backdrop), and prev/next when there
 * is more than one image. Renders nothing when there is no image.
 * Reused across the public org page and (later) the Boat Pro listing.
 */
export default function ImageLightbox({ images = [], index = 0, open, onClose, onIndexChange }) {
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const count = images.length;
  const go = useCallback((d) => { if (count > 1) onIndexChange?.((index + d + count) % count); }, [index, count, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(t);
      if (restoreRef.current?.focus) restoreRef.current.focus();
    };
  }, [open, go, onClose]);

  if (!open || count === 0) return null;
  const img = images[Math.min(index, count - 1)];
  if (!img?.src) return null;
  const resolved = img.src.startsWith("/api/") ? `${BACKEND_URL}${img.src}` : img.src;

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4" data-testid="image-lightbox"
      onClick={onClose} role="dialog" aria-modal="true" aria-label={img.alt || "Image viewer"}>
      <button ref={closeRef} type="button" onClick={(e) => { e.stopPropagation(); onClose?.(); }} data-testid="lightbox-close"
        aria-label="Close" className="absolute top-4 right-4 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center">
        <Icon name="close" tone="current" className="h-6 w-6" />
      </button>
      {count > 1 && (
        <div data-testid="lightbox-counter" className="absolute top-5 left-1/2 -translate-x-1/2 text-white/90 text-sm font-semibold bg-black/40 rounded-full px-3 py-1 pointer-events-none">
          {Math.min(index, count - 1) + 1} of {count}
        </div>
      )}
      {count > 1 && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} data-testid="lightbox-prev" aria-label="Previous image"
            className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center">
            <Icon name="chevron-left" tone="current" className="h-6 w-6" />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} data-testid="lightbox-next" aria-label="Next image"
            className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center">
            <Icon name="chevron-right" tone="current" className="h-6 w-6" />
          </button>
        </>
      )}
      <img src={resolved} alt={img.alt || ""} onClick={(e) => e.stopPropagation()} data-testid="lightbox-image"
        className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg" />
    </div>
  );
}
