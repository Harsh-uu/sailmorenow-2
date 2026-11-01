import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";

/**
 * "Posting as" selector (Step 8a, item 5). Shown in every composer for accounts
 * eligible to act as a business (Boat Pro with an active listing). Lets the
 * author choose the identity for THIS item only — it does NOT change the
 * account's active identity. Non-eligible accounts render nothing.
 *
 * `value` is the chosen identity ("personal" | "business"); `onChange(next)`.
 */
export default function PostingAs({ value, onChange, testId = "posting-as" }) {
  const { user } = useAuth();
  if (!user || !user.can_use_business) return null;
  const choices = [
    { id: "personal", label: "You", avatar: user.picture || user.avatar, biz: false },
    { id: "business", label: user.business_name || "Your business", avatar: user.business_logo, biz: true },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid={testId}>
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Posting as</span>
      <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
        {choices.map((c) => {
          const active = (value || "personal") === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              data-testid={`${testId}-${c.id}`}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-sm font-semibold transition-colors ${
                active ? "bg-[#1F3F5B] text-white dark:bg-[#F2A03B]" : "text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700"
              }`}
            >
              {c.biz
                ? <LogoCircle src={c.avatar} size="h-6 w-6" alt={c.label} fallback={<span className="text-[10px] font-bold text-[#1F3F5B]">{(c.label[0] || "B").toUpperCase()}</span>} />
                : <Avatar src={c.avatar} className="h-6 w-6" alt={c.label} />}
              <span className="truncate max-w-[10rem]">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
