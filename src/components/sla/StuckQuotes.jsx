import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { differenceInDays, differenceInHours, parseISO, format } from "date-fns";

const STUCK_STATUSES = [
  { key: "submitted", label: "Quote Pending Approval", color: "bg-blue-100 text-blue-700" },
  { key: "approved", label: "Quote Approved", color: "bg-emerald-100 text-emerald-700" },
  { key: "quote_sent_to_ho", label: "Quote Sent to HO", color: "bg-purple-100 text-purple-700" },
  { key: "ho_approved_invoice_required", label: "HO Approved, Invoice Required", color: "bg-amber-100 text-amber-700" },
  { key: "invoiced", label: "Quote Pending Payment", color: "bg-indigo-100 text-indigo-700" },
  { key: "draft_without_internal", label: "Quote Draft", color: "bg-slate-100 text-slate-700" },
  { key: "draft_without_fst", label: "Quote Missing Details", color: "bg-slate-100 text-slate-700" },
  { key: "pending_materials", label: "Quote Pending Materials", color: "bg-purple-100 text-purple-800" },
];

function getTimeInCurrentStatus(quote) {
  if (!quote.status_history || quote.status_history.length === 0) {
    return differenceInHours(new Date(), parseISO(quote.created_date));
  }
  const sorted = [...quote.status_history].sort((a, b) =>
    new Date(b.changed_at) - new Date(a.changed_at)
  );
  const lastChange = sorted[0];
  return differenceInHours(new Date(), parseISO(lastChange.changed_at));
}

export default function StuckQuotes({ quotes }) {
  const terminalStatuses = ["invoice_paid", "scheduled", "rejected", "ho_rejected"];
  const activeQuotes = quotes.filter(q => !terminalStatuses.includes(q.status));

  const stuckQuotes = activeQuotes
    .map(q => ({ ...q, hoursInStatus: getTimeInCurrentStatus(q) }))
    .filter(q => q.hoursInStatus >= 72) // 3+ days
    .sort((a, b) => b.hoursInStatus - a.hoursInStatus);

  const urgentCount = stuckQuotes.filter(q => q.hoursInStatus >= 168).length; // 7+ days

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-semibold text-slate-900">Stuck Quotes</h3>
          <span className="text-xs text-slate-400">(3+ days in same status)</span>
        </div>
        <div className="flex gap-2">
          <span className="text-sm font-medium text-slate-600">{stuckQuotes.length} stuck</span>
          {urgentCount > 0 && (
            <Badge className="bg-rose-100 text-rose-700 text-xs">{urgentCount} urgent (7+ days)</Badge>
          )}
        </div>
      </div>

      {stuckQuotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
            <Clock className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-slate-600 font-medium">No stuck quotes!</p>
          <p className="text-slate-400 text-sm mt-1">All active quotes have moved within the last 3 days.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Site ID</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Status</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Time Stuck</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Created By</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Created</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {stuckQuotes.map(q => {
                const days = (q.hoursInStatus / 24).toFixed(1);
                const isUrgent = q.hoursInStatus >= 168;
                const statusCfg = STUCK_STATUSES.find(s => s.key === q.status);
                return (
                  <tr key={q.id} className={`border-b border-slate-50 hover:bg-slate-50 ${isUrgent ? "bg-rose-50/40" : ""}`}>
                    <td className="py-3 px-3 font-medium text-slate-900">{q.site_id}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusCfg?.color || "bg-slate-100 text-slate-600"}`}>
                        {statusCfg?.label || q.status}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`flex items-center gap-1 font-semibold ${isUrgent ? "text-rose-600" : "text-amber-600"}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {days}d
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600 text-xs">{q.created_by || "—"}</td>
                    <td className="py-3 px-3 text-slate-500 text-xs">
                      {format(parseISO(q.created_date), "MMM d, yyyy")}
                    </td>
                    <td className="py-3 px-3">
                      <Link
                        to={createPageUrl(`QuoteDetails?id=${q.id}`)}
                        className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-xs font-medium"
                      >
                        View <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}