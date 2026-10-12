import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useUserRole} from "@/components/auth/RoleGuard";
import {selectQuoteAlerts} from "@/features/quotes/quoteAlertSelection";
import {computeQuoteAlert} from "@/utils/quoteSLA";
import {getStatusLabel} from "@/constants/quoteStatuses";
import {toast} from "sonner";
import {createLocalRecord, createLocalRecords, listLocalCollection} from "@/api/dataClient";
import {Link} from "react-router-dom";
import {createPageUrl} from "@/utils";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {AlertCircle, CheckCheck, ChevronDown, ChevronUp, Clock, Loader2, MessageSquarePlus, X} from "lucide-react";
import LogFollowUpDialog from "@/components/quotes/LogFollowUpDialog";
import {SiteIdLink} from "@/components/links/ExternalIdLinks";

export default function StatusAlerts({ quotes, preselected = false }) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [logQuote, setLogQuote] = useState(null);

  // "Clear All" is restricted to specific authorized users only.
  const ALLOWED_CLEAR_ALL_EMAILS = [
    "smosley@enphaseenergy.com",
    "REDACTED-USER1@example.invalid",
    "ajennings@enphaseenergy.com"
  ];
  const {user: currentUser, isAdmin} = useUserRole();
  const canClearAll = ALLOWED_CLEAR_ALL_EMAILS.includes(
    (currentUser?.email || "").toLowerCase()
  );

  // Fetch the current user's dismissed alert quote IDs from the database.
  // This is user-scoped via built-in row-level security (created_by_id),
  // so dismissals persist across devices and environments.
  // FIX (confirmed root cause): this previously called base44.entities.StatusAlertDismissal
  // directly, bypassing this app's actual local/base44 adapter system entirely. In desktop
  // ("local") mode, base44.entities does not exist at all -- the call silently threw, React
  // Query caught it into an error state, and this component's own `= []` fallback made
  // dismissals appear as an empty list FOREVER, regardless of what was actually dismissed.
  // Routed through listLocalCollection() -- the same function every other collection
  // (quotes, reviews, etc.) already uses correctly.
  const { data: dismissals = [], isLoading: dismissalsLoading, error: dismissalsError } = useQuery({
    queryKey: ["statusAlertDismissals"],
    queryFn: async () => {
      return await listLocalCollection("statusAlertDismissals");
    }
  });

  const dismissedQuoteIds = dismissals.map(d => d.quote_id);
  const {data: mentions = [], error: mentionsError} = useQuery({
    queryKey: ["quoteAlerts", "mentions", currentUser?.email],
    queryFn: async () => (await listLocalCollection("quoteAlerts"))
      .filter(item => item.mentioned_email === currentUser.email && !item.is_resolved),
    enabled: !preselected && Boolean(currentUser?.email)
  });

  const dismissMutation = useMutation({
    mutationFn: async (quoteId) => {
      await createLocalRecord("statusAlertDismissals", { quote_id: quoteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    },
    onError: error => toast.error(error.message || "Could not dismiss quote alert.")
  });

  const clearAllMutation = useMutation({
    mutationFn: async (quoteIds) => {
      await createLocalRecords(
        "statusAlertDismissals",
        quoteIds.map(id => ({ quote_id: id }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    },
    onError: error => toast.error(error.message || "Could not clear quote alerts.")
  });

  const alerts = (preselected ? quotes : selectQuoteAlerts(quotes, dismissals, mentions, currentUser?.email, isAdmin))
    .map(quote => ({quote, status: quote.status, alert: computeQuoteAlert(quote)}));

  if (dismissalsLoading) return null;
  if (dismissalsError) return <p role="alert">Could not load alert dismissals: {dismissalsError.message}</p>;
  if (mentionsError) return <p role="alert">Could not load quote alerts: {mentionsError.message}</p>;
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
    <Card className={`p-4 mb-6 border border-warning/20 border-l-4 border-l-warning bg-warning/10 ${collapsed ? "pb-4" : ""}`}>
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
                  className="h-7 text-xs border border-warning/20 border-l-4 border-l-warning text-amber-700 hover:bg-warning/10"
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
                className="h-7 text-xs border border-warning/20 border-l-4 border-l-warning text-amber-700 hover:bg-warning/10"
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
              <div key={index} className="flex items-center justify-between p-2 rounded bg-card hover:bg-warning/10 transition-colors group">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">
                    {alert.quote.site_id ? <SiteIdLink siteId={alert.quote.site_id} className="font-medium" /> : alert.quote.quote_number}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {getStatusLabel(alert.status) || alert.status}
                  </span>
                  <Link
                    to={createPageUrl(`QuoteDetails?id=${alert.quote.id}`)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    View
                  </Link>
                </div>
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
                    {alert.alert?.timeLabel || "Mentioned"}
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