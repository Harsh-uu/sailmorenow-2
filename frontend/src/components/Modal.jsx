import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { createPortal } from "react-dom";

/**
 * Portal-mounted modal with all the good defaults:
 *  • Renders at document.body so ancestor CSS transforms/overflow don't trap it
 *  • Escape closes; backdrop click closes; clicks inside the card do NOT close
 *  • Body scroll is locked while open
 *  • Scrollable content region uses min-h-0 (flex scroll pattern that actually works)
 *  • Mobile: bottom-sheet fill; sm+: centered dialog capped at 85dvh
 *
 * Props:
 *   open        boolean
 *   onClose     () => void
 *   title       string | ReactNode (optional; renders in header)
 *   eyebrow     string | ReactNode (optional; small label above the title)
 *   size        "sm" | "md" | "lg"  default "md" (max-w-2xl)
 *   children    the modal body — put your form / list here
 *   footer      optional sticky footer (ReactNode)
 *   testId      data-testid for the outer wrapper (default "modal")
 *   closeOnBackdrop  default true
 */
const SIZE = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" };

export default function Modal({
  open,
  onClose,
  title,
  eyebrow,
  size = "md",
  children,
  footer,
  testId = "modal",
  closeOnBackdrop = true,
}) {
  const cardRef = useRef(null);
  const prevFocus = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      try { if (cardRef.current && !cardRef.current.contains(document.activeElement)) cardRef.current.focus(); } catch { /* noop */ }
    }, 0);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      try { prevFocus.current?.focus?.(); } catch { /* noop */ }
    };
  }, [open]);

  if (!open) return null;

  const handleBackdrop = () => { if (closeOnBackdrop) onClose?.(); };

  const node = (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/70 sm:backdrop-blur-md overscroll-contain"
         onClick={handleBackdrop} data-testid={testId}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1}
           className={`bg-white w-full ${SIZE[size]} sm:rounded-2xl h-[85dvh] sm:h-auto sm:max-h-[85dvh] shadow-2xl flex flex-col overflow-hidden outline-none`}
           onClick={(e) => e.stopPropagation()}>
        {(title || eyebrow) && (
          <header className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="min-w-0 pr-2">
              {eyebrow && (
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD] flex items-center gap-2">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h3 className="font-display font-bold text-lg text-[#1F3F5B] mt-0.5 leading-tight truncate">{title}</h3>
              )}
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 shrink-0" data-testid={`${testId}-close`}>
              <Icon name="close" tone="current" className="h-5 w-5 text-slate-500" />
            </button>
          </header>
        )}
        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
          {children}
        </div>
        {footer && (
          <footer className="p-4 border-t border-slate-100 shrink-0 flex items-center justify-end gap-2 bg-white">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
