import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { LayoutGrid } from "lucide-react";

const STATUS_CONFIG = [
  { key: "draft_without_internal", label: "Quote Draft", color: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  { key: "draft_without_fst", label: "Quote Missing Details", color: "bg-slate-100 text-slate-700", dot: "bg-slate-500" },
  { key: "submitted", label: "Quote Pending Approval", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  { key: "approved", label: "Quote Approved", color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { key: "rejected", label: "Rejected", color: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  { key: "quote_sent_to_ho", label: "Quote Sent to HO", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  { key: "ho_approved_invoice_required", label: "HO Approved, Invoice Required", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  { key: "ho_rejected", label: "HO Rejected", color: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  { key: "invoiced", label: "Quote Pending Payment", color: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  { key: "invoice_paid", label: "Invoice Paid", color: "bg-green-100 text-green-700", dot: "bg-green-500" },
  { key: "scheduled", label: "Scheduled", color: "bg-teal-100 text-teal-700", dot: "bg-teal-500" },
  { key: "pending_materials", label: "Quote Pending Materials", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  { key: "on_hold", label: "On Hold (Boneyard)", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
];

export default function StatusSnapshot({ quotes, allQuotes }) {
  // Use allQuotes for current live snapshot, quotes for period context
  const liveQuotes = allQuotes;

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center gap-2 mb-4">
        <LayoutGrid className="w-5 h-5 text-slate-600" />
        <h3 className="text-lg font-semibold text-slate-900">Current Quote Status Snapshot</h3>
        <span className="text-xs text-slate-400 ml-1">(all time, live)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATUS_CONFIG.map(s => {
          const count = liveQuotes.filter(q => q.status === s.key).length;
          return (
            <Link key={s.key} to={createPageUrl(`Quotes?status=${s.key}`)}>
              <div className={`rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow ${s.color.replace("text-", "border-").replace("-700", "-200").replace("-100", "-50")} border bg-white`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <p className="text-xs font-medium text-slate-600 leading-tight">{s.label}</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">{count}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}