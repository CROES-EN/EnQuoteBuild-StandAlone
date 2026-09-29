import {useEffect, useState} from "react";
import {motion} from "framer-motion";
import {ShieldCheck, ShieldOff} from "lucide-react";
import {Card} from "@/components/ui/card";
import {getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {getEligibilityForSiteId} from "@/features/supervisorDashboard/careEligibility";

/**
 * Enphase Care eligibility banner for the Quote Details screen - per explicit request,
 * shown in the same Card + motion.div style already used by this page's other single-
 * quote status banners (On Hold, Rejection Reason, HO Rejection, Deletion Request).
 *
 * Reuses careEligibility.js's getEligibilityForSiteId() directly - the exact same single
 * source of truth already used by the Care Data Hygiene report and the Workload tab's
 * "Care" badge, so this banner can never disagree with either of those.
 *
 * Deliberately renders NOTHING for NOT_FOUND (no Care Subscriptions record at all for
 * this Site ID) - per careEligibility.js's own "honest, conservative, never guess"
 * design, an absent record isn't meaningful evidence either way (could simply mean the
 * report hasn't been re-imported recently, or this site was never a Care customer), so
 * showing a banner for it would be misleading rather than informative.
 */
export default function CareEligibilityBanner({ siteId }) {
  const [eligibility, setEligibility] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEligibility() {
      if (!siteId) { if (!cancelled) setEligibility(null); return; }
      try {
        const table = await getReportTable("care_subscriptions");
        const rows = Array.isArray(table?.rows) ? table.rows : [];
        const result = getEligibilityForSiteId(siteId, rows);
        if (!cancelled) setEligibility(result);
      } catch {
        if (!cancelled) setEligibility(null);
      }
    }
    loadEligibility();
    return () => { cancelled = true; };
  }, [siteId]);

  if (!eligibility || eligibility.status === "NOT_FOUND") return null;

  const isActive = eligibility.status === "ACTIVE_CARE";
  const Icon = isActive ? ShieldCheck : ShieldOff;
  const reasonLabel = { expired: "expired", cancelled: "cancelled", inactive: "inactive" }[eligibility.reason] || "inactive";

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={isActive ? "p-4 mb-6 bg-emerald-50 border-emerald-300" : "p-4 mb-6 bg-amber-50 border-amber-300"}>
        <div className="flex items-start gap-3">
          <Icon className={isActive ? "w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" : "w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0"} />
          <div className="flex-1">
            <p className={isActive ? "font-semibold text-emerald-800" : "font-semibold text-amber-800"}>
              {isActive ? "Active Enphase Care" : "No Active Enphase Care"}
            </p>
            <p className={isActive ? "text-emerald-700 text-sm mt-0.5" : "text-amber-700 text-sm mt-0.5"}>
              {isActive
                ? "Travel and labor fees may be waived for this visit under Enphase Care if a covered device is involved."
                : `This site's Care subscription is ${reasonLabel} - do not assume travel/labor coverage.`}
            </p>
            {eligibility.current?.planName && (
              <p className={isActive ? "text-emerald-600 text-xs mt-1" : "text-amber-600 text-xs mt-1"}>
                Plan: {eligibility.current.planName}
                {eligibility.renewalCount > 0 ? ` - renewed ${eligibility.renewalCount}x` : ""}
              </p>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}