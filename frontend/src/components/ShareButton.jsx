import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";
import { buildShareUrl, shareContent } from "@/lib/share";

// Reusable share trigger. `path` is a relative app route (e.g. "/directory/x").
// The sharer's handle/name is appended as ?ref= for attribution + invite copy.
export default function ShareButton({
  path,
  title = "Sail More Now",
  text = "",
  label = "Share",
  iconName = "share",
  iconOnly = false,
  className,
  testId = "share-btn",
}) {
  const { user } = useAuth();
  const onShare = () => {
    const ref = user?.handle || user?.name || null;
    const url = buildShareUrl(path, ref);
    shareContent({ title, text: text || title, url });
  };
  const cls =
    className ||
    "inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-[#55B3AD] transition-colors";
  return (
    <button onClick={onShare} data-testid={testId} className={cls} title="Share" type="button">
      <Icon name={iconName} tone="current" className="h-4 w-4" /> {!iconOnly && label}
    </button>
  );
}
