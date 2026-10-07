import {Card} from "@/components/ui/card";
import {Link} from "react-router-dom";
import {createPageUrl} from "@/utils";
import {LayoutGrid} from "lucide-react";

const STATUS_CONFIG = [
  { key: "draft_without_internal", label: "Quote Draft", dot: "bg-slate-400" },
  { key: "draft_without_fst", label: "Quote Missing Details", dot: "bg-slate-500" },
  { key: "submitted", label: "Quote Pending Approval", dot: "bg-blue-500" },
  { key: "approved", label: "Quote Approved", dot: "bg-emerald-500" },
  { key: "rejected", label: "Rejected", dot: "bg-rose-500" },
  { key: "quote_sent_to_ho", label: "Quote Sent to HO", dot: "bg-purple-500" },
  { key: "ho_approved_invoice_required", label: "HO Approved, Invoice Required", dot: "bg-amber-500" },
  { key: "ho_rejected", label: "HO Rejected", dot: "bg-rose-500" },
  { key: "invoiced", label: "Quote Pending Payment", dot: "bg-indigo-500" },
  { key: "invoice_paid", label: "Invoice Paid", dot: "bg-green-500" },
  { key: "scheduled", label: "Scheduled", dot: "bg-teal-500" },
  { key: "pending_materials", label: "Quote Pending Materials", dot: "bg-purple-500" },
  { key: "on_hold", label: "On Hold (Boneyard)", dot: "bg-amber-500" },
];

export default function StatusSnapshot({ allQuotes }) {
  const liveQuotes = allQuotes;

  return (
    <Card className="p-6 border-border">
      <div className="flex items-center gap-2 mb-4">
        <LayoutGrid className="w-5 h-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">Current Quote Status Snapshot</h3>
        <span className="text-xs text-muted-foreground ml-1">(all time, live)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATUS_CONFIG.map(s => {
          const count = liveQuotes.filter(q => q.status === s.key).length;
          return (
            <Link key={s.key} to={createPageUrl(`Quotes?status=${s.key}`)}>
              <div className="rounded-xl p-4 cursor-pointer transition-colors border border-border bg-card text-card-foreground hover:border-primary">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <p className="text-xs font-medium text-card-foreground leading-tight">{s.label}</p>
                </div>
                <p className="text-3xl font-bold text-card-foreground">{count}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}