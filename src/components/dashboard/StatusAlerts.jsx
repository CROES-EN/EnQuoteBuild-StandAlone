import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, X, CheckCheck, Loader2, ChevronDown, ChevronUp, MessageSquarePlus } from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";
import LogFollowUpDialog from "@/components/quotes/LogFollowUpDialog";
import { INVOICE_PAID_ALERT_CUTOFF } from "@/utils/quoteSLA";

const STATUS_THRESHOLDS = {
  draft_without_internal: 3,
  draft_without_fst: 3,
  submitted: 3,
  approved: 5,
  rejected: 5,
  quote_sent_to_ho: 5,
  ho_approved_invoice_required: 7,
  ho_rejected: 5,
  invoiced: 14,
  invoice_paid: 2,
  pending_materials: 10,
  on_hold: 30
};

const STATUS_LABELS = {
  draft_without_internal: "Draft",
  draft_without_fst: "Missing Details",
  submitted: "Awaiting Approval",
  approved: "Approved",
  rejected: "Rejected",
  quote_sent_to_ho: "Sent to HO",
  ho_approved_invoice_required: "Awaiting Invoice",
  ho_rejected: "HO Rejected",
  invoiced: "Awaiting Payment",
  invoice_paid: "Awaiting Scheduling",
  pending_materials: "Pending Materials",
  on_hold: "On Hold"
};

export default function StatusAlerts({ quotes }) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [logQuote, setLogQuote] = useState(null);

  // "Clear All" is restricted to specific authorized users only.
  const ALLOWED_CLEAR_ALL_EMAILS = [
    "smosley@enphaseenergy.com",
    "tjm8189@gmail.com",
    "ajennings@enphaseenergy.com"
  ];
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const canClearAll = ALLOWED_CLEAR_ALL_EMAILS.includes(
    (currentUser?.email || "").toLowerCase()
  );

  // Fetch the current user's dismissed alert quote IDs from the database.
  // This is user-scoped via built-in row-level security (created_by_id),
  // so dismissals persist across devices and environments.
  const { data: dismissals = [], isLoading: dismissalsLoading } = useQuery({
    queryKey: ["statusAlertDismissals"],
    queryFn: async () => {
      return await base44.entities.StatusAlertDismissal.list("-created_date", 500);
    }
  });

  const dismissedQuoteIds = dismissals.map(d => d.quote_id);

  const dismissMutation = useMutation({
    mutationFn: async (quoteId) => {
      await base44.entities.StatusAlertDismissal.create({ quote_id: quoteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    }
  });

  const clearAllMutation = useMutation({
    mutationFn: async (quoteIds) => {
      await base44.entities.StatusAlertDismissal.bulkCreate(
        quoteIds.map(id => ({ quote_id: id }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    }
  });

  const now = new Date();
  const allAlerts = [];

  quotes.forEach(quote => {
    if (quote.status === "scheduled") return;
    if (quote.status === "on_hold") return;
    if (quote.exclude_from_reporting) return;
    // HO Rejected quotes with a reason logged are considered handled — don't flag them
    if (quote.status === "ho_rejected" && quote.ho_rejection_reason && quote.ho_rejection_reason.trim()) return;

    // Draft quotes are only flagged if they've been previously submitted — i.e.
    // they went through the approval/review cycle (submitted → rejected/approved/
    // missing details) and bounced back to draft. A fresh draft is not flagged.
    const isDraft = quote.status === "draft_without_internal" || quote.status === "draft_without_fst";
    if (isDraft) {
      const wasSubmitted = (quote.status_history || []).some(
        (entry) => entry.status === "submitted"
      );
      if (!wasSubmitted) return;
    }

    const threshold = STATUS_THRESHOLDS[quote.status];
    if (!threshold) return;

    let statusDate;
    if (quote.status_history?.length > 0) {
      statusDate = parseISO(quote.status_history[quote.status_history.length - 1].changed_at);
    } else if (quote.created_date) {
      statusDate = parseISO(quote.created_date);
    }

    if (!statusDate) return;

    // Legacy Invoice Paid quotes (moved before the scheduling-alert cutoff) are
    // exempt — only quotes transitioned on/after the cutoff are flagged.
    if (quote.status === "invoice_paid") {
      const paidDate = quote.invoice_paid_date ? parseISO(quote.invoice_paid_date) : statusDate;
      if (paidDate && paidDate < INVOICE_PAID_ALERT_CUTOFF) return;
    }

    const daysInStatus = differenceInDays(now, statusDate);

    if (daysInStatus >= threshold) {
      allAlerts.push({
        quote,
        daysInStatus,
        threshold,
        status: quote.status
      });
    }
  });

  allAlerts.sort((a, b) => b.daysInStatus - a.daysInStatus);

  const alerts = allAlerts.filter(a => !dismissedQuoteIds.includes(a.quote.id));

  if (dismissalsLoading) return null;
  if (alerts.length === 0) return null;

  const handleClearAll = () => {
    const newIds = alerts
      .filter(a => !dismissedQuoteIds.includes(a.quote.id))
      .map(a => a.quote.id);
    if (newIds.length > 0) {
      clearAllMutation.mutate(newIds);
    }
  };

  return (
    <Card className={`p-4 mb-6 border-amber-300 bg-amber-50 ${collapsed ? "pb-4" : ""}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-amber-900">
              Attention Required: {alerts.length} quote{alerts.length > 1 ? "s" : ""} need attention
            </h3>
            <div className="flex items-center gap-2">
              {!collapsed && canClearAll && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                  onClick={handleClearAll}
                  disabled={clearAllMutation.isPending}
                >
                  {clearAllMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  )}
                  Clear All
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={() => setCollapsed(!collapsed)}
                title={collapsed ? "Expand" : "Collapse to review later"}
              >
                {collapsed ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronUp className="w-3.5 h-3.5 mr-1" />}
                {collapsed ? "Expand" : "Later"}
              </Button>
            </div>
          </div>
          {!collapsed && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {alerts.map((alert, index) => (
              <div key={index} className="flex items-center justify-between p-2 rounded bg-white hover:bg-amber-100 transition-colors group">
                <Link
                  to={createPageUrl(`QuoteDetails?id=${alert.quote.id}`)}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-sm font-medium text-slate-900 truncate">
                    {alert.quote.site_id || alert.quote.quote_number}
                  </span>
                  <span className="text-xs text-slate-600 shrink-0">
                    {STATUS_LABELS[alert.status] || alert.status}
                  </span>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
                    onClick={() => setLogQuote(alert.quote)}
                    title="Log Follow-Up"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />
                    Log
                  </Button>
                  <span className="text-xs font-medium text-amber-700">
                    {alert.daysInStatus} days
                  </span>
                  <button
                    onClick={() => dismissMutation.mutate(alert.quote.id)}
                    disabled={dismissMutation.isPending}
                    className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-50"
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
      {logQuote && (
        <LogFollowUpDialog
          quote={logQuote}
          open={!!logQuote}
          onOpenChange={(v) => !v && setLogQuote(null)}
          onLogged={() => dismissMutation.mutate(logQuote.id)}
        />
      )}
    </Card>
  );
}