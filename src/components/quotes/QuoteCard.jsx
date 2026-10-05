import {Card} from "@/components/ui/card";
import {format} from "date-fns";
import {Calendar, FileText, ShieldCheck, User} from "lucide-react";
import {useNavigate} from "react-router-dom";
import {createPageUrl} from "@/utils";
import {calculateQuoteTotals} from "@/utils/quoteCalculations";
import {getEffectiveLevel} from "@/utils/quoteSLA";
import StatusBadge from "./StatusBadge";
import {MentionBadge, SLAAlertBadge} from "./AlertBadge";
import {motion} from "framer-motion";
import {Checkbox} from "@/components/ui/checkbox";
import {useCareEligibilityIndex} from "@/features/supervisorDashboard/careEligibilityCache";
import {getEligibilityFromIndex} from "@/features/supervisorDashboard/careEligibility";
import {SiteIdLink} from "@/components/links/ExternalIdLinks";

export default function QuoteCard({ quote, index = 0, selectable = false, isSelected = false, onToggleSelect, alert = null, hasMention = false, mentionPriority, mentionMessage, mentionedBy, onClearAlert }) {
  const navigate = useNavigate();
  const { total: calculatedTotal } = calculateQuoteTotals(quote);
  const effectiveLevel = getEffectiveLevel(alert, hasMention, mentionPriority);
  const careIndex = useCareEligibilityIndex();
  const careEligibility = careIndex ? getEligibilityFromIndex(quote.site_id, careIndex) : null;
  const hasActiveCare = careEligibility?.status === "ACTIVE_CARE";
  const stripeClass = effectiveLevel === "red"
    ? "border-l-4 border-l-red-500"
    : effectiveLevel === "orange"
    ? "border-l-4 border-l-orange-500"
    : effectiveLevel === "yellow"
    ? "border-l-4 border-l-amber-500"
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div
        role="link"
        tabIndex={0}
        onClick={() => navigate(createPageUrl(`QuoteDetails?id=${quote.id}`))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(createPageUrl(`QuoteDetails?id=${quote.id}`));
          }
        }}
      >
        <Card className={`p-5 hover:shadow-lg transition-all duration-300 border-border hover:border-indigo-200 group cursor-pointer ${stripeClass} ${isSelected ? "ring-2 ring-indigo-400 border-indigo-400" : ""}`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              {selectable && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect?.(quote.id)}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  className="shrink-0"
                />
              )}
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-indigo-600 transition-colors">
                  <SiteIdLink siteId={quote.site_id} fallback="No Site ID" className="font-semibold" />
                </h3>
                <p className="text-sm text-muted-foreground">{quote.quote_number || "No reference"}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={quote.status} size="small" />
              {quote.status_history?.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {format(new Date(quote.status_history[quote.status_history.length - 1].changed_at), "MMM d, yyyy")}
                </span>
              )}
              {alert && <SLAAlertBadge alert={alert} onClear={() => onClearAlert?.(quote.id)} />}
              {hasMention && (
                <MentionBadge priority={mentionPriority} message={mentionMessage} mentionedBy={mentionedBy} />
              )}
            </div>
          </div>
          
          <div className="space-y-2 text-sm">
            {/* CARE_SHIELD_ABOVE_TOTAL: positioned directly above the divider line and the
                dollar total below it, right-aligned so it sits visually right above the $
                figure - per explicit request, moved here from next to the Site ID title. */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                {quote.created_date && !Number.isNaN(new Date(quote.created_date).getTime())
                  ? format(new Date(quote.created_date), "MMM d, yyyy")
                  : "Unknown"}
              </div>
              {hasActiveCare && (
                <span title="Active Enphase Care">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                </span>
              )}
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {quote.items?.length || 0} item{quote.items?.length !== 1 ? "s" : ""}
              </span>
              {(quote.created_by_email || quote.owner_email || quote.created_by || quote.status_history?.[0]?.changed_by) && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {(quote.created_by_email || quote.status_history?.[0]?.changed_by || quote.owner_email || quote.created_by).split("@")[0]}
                </span>
              )}
            </div>
            <span className="text-lg font-bold text-foreground">
              ${calculatedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}