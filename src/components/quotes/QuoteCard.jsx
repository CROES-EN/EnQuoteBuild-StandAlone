import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { FileText, Calendar, User } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { calculateQuoteTotals } from "@/utils/quoteCalculations";
import { getEffectiveLevel } from "@/utils/quoteSLA";
import StatusBadge from "./StatusBadge";
import { SLAAlertBadge, MentionBadge } from "./AlertBadge";
import { motion } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";

export default function QuoteCard({ quote, index = 0, selectable = false, isSelected = false, onToggleSelect, alert = null, hasMention = false, mentionPriority, mentionMessage, mentionedBy, onClearAlert }) {
  const { total: calculatedTotal } = calculateQuoteTotals(quote);
  const effectiveLevel = getEffectiveLevel(alert, hasMention, mentionPriority);
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
      <Link to={createPageUrl(`QuoteDetails?id=${quote.id}`)}>
        <Card className={`p-5 hover:shadow-lg transition-all duration-300 border-slate-200 hover:border-indigo-200 group cursor-pointer ${stripeClass} ${isSelected ? "ring-2 ring-indigo-400 border-indigo-400" : ""}`}>
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
                <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  {quote.site_id || "No Site ID"}
                </h3>
                <p className="text-sm text-slate-500">{quote.quote_number || "No reference"}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusBadge status={quote.status} size="small" />
              {quote.status_history?.length > 0 && (
                <span className="text-xs text-slate-400">
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
            <div className="flex items-center gap-2 text-slate-600">
              <Calendar className="w-4 h-4 text-slate-400" />
              {format(new Date(quote.created_date), "MMM d, yyyy")}
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-500">
                {quote.items?.length || 0} item{quote.items?.length !== 1 ? "s" : ""}
              </span>
              {(quote.owner_email || quote.created_by) && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {(quote.owner_email || quote.created_by).split("@")[0]}
                </span>
              )}
            </div>
            <span className="text-lg font-bold text-slate-900">
              ${calculatedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}