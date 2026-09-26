import {LayoutGrid} from "lucide-react";
import {cn} from "@/lib/utils";

const STATUS_CARDS = [
  { label: "Quote Draft", status: "draft_without_internal", color: "bg-slate-400" },
  { label: "Quote Missing Details", status: "draft_without_fst", color: "bg-slate-400" },
  { label: "Quote Pending Approval", status: "submitted", color: "bg-blue-500" },
  { label: "Quote Approved", status: "approved", color: "bg-emerald-500" },
  { label: "Rejected", status: "rejected", color: "bg-rose-500" },
  { label: "Quote Sent to HO", status: "quote_sent_to_ho", color: "bg-purple-500" },
  { label: "HO Approved, Invoice Required", status: "ho_approved_invoice_required", color: "bg-amber-500" },
  { label: "HO Rejected", status: "ho_rejected", color: "bg-rose-500" },
  { label: "Quote Pending Payment", status: "invoiced", color: "bg-indigo-500" },
  { label: "Invoice Paid", status: "invoice_paid", color: "bg-emerald-500" },
  { label: "Scheduled", status: "scheduled", color: "bg-teal-500" },
  { label: "Quote Pending Materials", status: "pending_materials", color: "bg-purple-500" },
  { label: "On Hold (Boneyard)", status: "on_hold", color: "bg-amber-500" },
];

export default function QuoteStatusSnapshot({ quotes, activeStatus, onSelectStatus }) {
  const counts = STATUS_CARDS.map(card => ({
    ...card,
    count: quotes.filter(q => q.status === card.status).length,
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <LayoutGrid className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">Current Quote Status Snapshot</h4>
        <span className="text-xs text-muted-foreground">(all time, live)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {counts.map(card => {
          const isActive = activeStatus === card.status;
          return (
            <button
              key={card.status}
              onClick={() => onSelectStatus?.(isActive ? "all" : card.status)}
              className={cn(
                "border rounded-lg p-3 bg-card text-left transition-all hover:shadow-md hover:-translate-y-0.5",
                isActive ? "border-indigo-500 ring-2 ring-indigo-100" : "border-border"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${card.color}`} />
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{card.count}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}