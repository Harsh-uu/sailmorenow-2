import React from "react";

// Splits text into plain text, @mentions, emails, and web URLs. Only http(s)
// and mailto are ever turned into links (no javascript:/data: etc.), and links
// open in a new tab with noopener. Used by posts, comments, forum and blog.
const TOKEN_RE =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,:;"')\]}]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_]{3,20})/g;

export function Linkify({ text }) {
  if (!text) return null;
  const parts = String(text).split(TOKEN_RE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^@[A-Za-z0-9_]{3,20}$/.test(p)) {
      return <span key={i} className="font-semibold text-sky-600" data-testid="mention-token">{p}</span>;
    }
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p)) {
      return <a key={i} href={`mailto:${p}`} className="text-[#2A7871] underline break-words">{p}</a>;
    }
    if (/^(https?:\/\/|www\.)/i.test(p)) {
      const href = /^www\./i.test(p) ? `https://${p}` : p;
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow"
           onClick={(e) => e.stopPropagation()} className="text-[#2A7871] underline break-words">{p}</a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export default Linkify;
