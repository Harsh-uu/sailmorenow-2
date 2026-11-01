import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProfilePreviewCard from "@/components/ProfilePreviewCard";

/**
 * Wraps an author name/avatar so it links to that member's profile (/u/:handle).
 * On hover (desktop) it shows a quick profile preview card with a Follow button.
 * Falls back to plain content when no handle is available.
 */
export default function AuthorLink({ handle, children, className = "", stop = true, testId }) {
  const [show, setShow] = useState(false);
  const timer = useRef();
  if (!handle) return children;
  const enter = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setShow(true), 350); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setShow(false), 200); };
  return (
    <span className="relative inline-flex items-center" onMouseEnter={enter} onMouseLeave={leave}>
      <Link
        to={`/u/${handle}`}
        data-testid={testId}
        className={`hover:underline ${className}`}
        onClick={(e) => { if (stop) e.stopPropagation(); }}
      >
        {children}
      </Link>
      {show && <ProfilePreviewCard handle={handle} onMouseEnter={enter} onMouseLeave={leave} />}
    </span>
  );
}
