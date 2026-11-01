import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";
import { loadMatrix, accountTypeKey, findFeature, levelsWith, planDest } from "@/lib/planMatrix";

// Shared short locked-feature prompt (web). Reads the matrix "short" line and the
// plans that include the feature, shows a primary action (upgrade / contact) and
// a "See plan details" link to My plan. Stays in place (inline); does not force a
// navigation. Pass `typeKey` to override the account type inferred from the user.
export default function PlanPrompt({ featureKey, typeKey, fallback = "This is a Premium feature.", primaryLabel, primaryTo, testId = "plan-prompt" }) {
  const { user } = useAuth();
  const [matrix, setMatrix] = useState(null);
  useEffect(() => { loadMatrix().then(setMatrix).catch(() => setMatrix(null)); }, []);

  const tk = typeKey || accountTypeKey(user);
  const feat = matrix ? findFeature(matrix, tk, featureKey) : null;
  const short = feat?.short || fallback;
  const includedIn = matrix ? levelsWith(matrix, tk, featureKey) : [];
  const dest = planDest(user);
  const isOrg = tk === "organization";
  const ctaTo = primaryTo || (isOrg ? "/contact" : dest);
  const ctaLabel = primaryLabel || (isOrg ? "Contact us to upgrade" : "Upgrade");

  return (
    <div data-testid={testId} className="rounded-xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.06] dark:bg-[#F2A03B]/[0.10] p-4">
      <div className="flex items-start gap-2.5">
        <Icon name="lock" tone="current" className="h-4 w-4 mt-0.5 text-[#d98c30] shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold smn-heading" data-testid={`${testId}-short`}>{short}</p>
          {includedIn.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5" data-testid={`${testId}-included`}>
              Included with {includedIn.join(", ")}.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Link to={ctaTo} data-testid={`${testId}-primary`}
                  className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-4 py-1.5 text-sm font-semibold">
              <Icon name="sparkles" tone="current" className="h-3.5 w-3.5" /> {ctaLabel}
            </Link>
            <Link to={dest} data-testid={`${testId}-details`} className="text-sm font-semibold text-[#1F3F5B] dark:text-[#7fcac4] hover:underline">
              See plan details
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
