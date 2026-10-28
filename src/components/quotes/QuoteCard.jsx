import {Card} from "@/components/ui/card";
import {format} from "date-fns";
import {Calendar, FileText, MessageSquarePlus, Pencil, Receipt, ShieldCheck, Sparkles, User} from "lucide-react";
import {Badge} from "@/components/ui/badge";
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
import {showsInvoiceNumber} from "@/features/quotes/invoiceNumber";
import PanelRmaBadge from "@/components/rma/PanelRmaBadge";

export default function QuoteCard({ quote, index = 0, selectable = false, isSelected = false, onToggleSelect, alert = null, hasMention = false, mentionPriority, mentionMessage, mentionedBy, onClearAlert, golden = false, onEditInvoiceNumber, onLogFollowUp, panelRma = null }) {
  const navigate = useNavigate();
  const { total: calculatedTotal } = calculateQuoteTotals(quote);
  const effectiveLevel = getEffectiveLevel(alert, hasMention, mentionPriority);
  const careIndex = useCareEligibilityIndex();
  const careEligibility = careIndex ? getEligibilityFromIndex(quote.site_id, careIndex) : null;
  const hasActiveCare = careEligibility?.status === "ACTIVE_CARE";
  const isNestedInteractiveTarget = (event) => {
    const interactive = event.target?.closest?.("a, button, [role='checkbox']");
    return Boolean(interactive && interactive !== event.currentTarget);
  };
  const handleCardClick = (event) => {
    if (isNestedInteractiveTarget(event)) return;
    if (selectable) {
      onToggleSelect?.(quote.id);
      return;
    }
    navigate(createPageUrl(`QuoteDetails?id=${quote.id}`));
  };
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
      className="h-full"
    >
      <div
        className="h-full"
        role={selectable ? "checkbox" : "link"}
        data-enquote-share-target={`quote:${quote.id}`}
        data-enquote-share-route={createPageUrl(`QuoteDetails?id=${encodeURIComponent(quote.id)}${quote.quote_number ? `&quoteNumber=${encodeURIComponent(quote.quote_number)}` : ""}`)}
        aria-label={`Quote ${quote.quote_number || quote.site_id || quote.id}`}
        aria-checked={selectable ? isSelected : undefined}
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(event) => {
          if (isNestedInteractiveTarget(event)) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selectable) onToggleSelect?.(quote.id);
            else navigate(createPageUrl(`QuoteDetails?id=${quote.id}`));
          }
        }}
      >
        <Card className={`h-full flex flex-col p-5 hover:shadow-lg transition-all duration-300 border-border hover:border-indigo-200 group cursor-pointer ${stripeClass} ${isSelected ? "ring-2 ring-indigo-400 border-indigo-400" : ""} ${golden ? "golden-quote-card" : ""}`}>
          {golden && <div className="mb-3 flex items-center gap-2">
            <Badge className="golden-quote-badge gap-1"><Sparkles className="w-3.5 h-3.5" /> Golden Quote</Badge>
            <span className="text-xs text-muted-foreground">SOP followed perfectly</span>
          </div>}
          <div className="flex items-start justify-between gap-2 mb-4">
            <div className="flex min-w-0 items-center gap-3">
              {selectable && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect?.(quote.id)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="shrink-0"
                />
              )}
              <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-foreground group-hover:text-indigo-600 transition-colors">
                    <SiteIdLink siteId={quote.site_id} fallback="No Site ID" className="font-semibold" />
                  </h3>
                  {onLogFollowUp && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-teal-600 hover:bg-teal-500/10 hover:text-teal-500"
                      onClick={(event) => { event.stopPropagation(); onLogFollowUp(quote); }}
                      onKeyDown={(event) => event.stopPropagation()}
                      aria-label="Log follow-up"
                      title="Log follow-up"
                      data-quote-card-log
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="truncate whitespace-nowrap text-sm text-muted-foreground">{quote.quote_number || "No reference"}</p>
                {(quote.invoice_number || (onEditInvoiceNumber && showsInvoiceNumber(quote))) && (
                  <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground" data-quote-card-invoice>
                    <Receipt className="w-3 h-3 shrink-0" />
                    <span className={`truncate ${quote.invoice_number ? "font-medium text-foreground" : "italic"}`} title={quote.invoice_number || undefined} data-quote-card-invoice-number>
                      {quote.invoice_number || "Add invoice #"}
                    </span>
                    {onEditInvoiceNumber && (
                      <button
                        type="button"
                        className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-blue-600"
                        onClick={(event) => { event.stopPropagation(); onEditInvoiceNumber(quote); }}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={quote.invoice_number ? "Edit invoice number" : "Add invoice number"}
                        title={quote.invoice_number ? "Edit invoice number" : "Add invoice number"}
                        data-quote-card-edit-invoice
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge status={quote.status} size="small" />
              {quote.status_history?.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {format(new Date(quote.status_history[quote.status_history.length - 1].changed_at), "MMM d, yyyy")}
                </span>
              )}
            </div>
          </div>
          {(alert || hasMention) && (
            <div className="-mt-2 mb-3 flex flex-wrap items-center justify-end gap-1" data-quote-card-alerts>
              {alert && <SLAAlertBadge alert={alert} onClear={() => onClearAlert?.(quote.id)} />}
              {hasMention && (
                <MentionBadge priority={mentionPriority} message={mentionMessage} mentionedBy={mentionedBy} />
              )}
            </div>
          )}
          
          <div className="space-y-2 text-sm flex-1">
            {panelRma && <div className="flex" data-quote-card-panel-rma><PanelRmaBadge rma={panelRma} /></div>}
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