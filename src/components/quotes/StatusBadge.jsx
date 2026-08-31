import { cn } from "@/lib/utils";

const statusConfig = {
  draft_without_internal: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    label: "Quote Draft"
  },
  draft_without_fst: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
    label: "Quote Missing Details"
  },
  draft: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    label: "Quote Draft"
  },
  submitted: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-500",
    label: "Quote Pending Approval"
  },
  approved: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    label: "Quote Approved"
  },
  rejected: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    dot: "bg-rose-500",
    label: "Rejected"
  },
  quote_sent_to_ho: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    dot: "bg-purple-500",
    label: "Quote Sent to HO"
  },
  ho_approved_invoice_required: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    dot: "bg-orange-500",
    label: "HO Approved, Invoice Required"
  },
  invoiced: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
    label: "Quote Pending Payment"
  },
  invoice_paid: {
    bg: "bg-green-50",
    text: "text-green-700",
    dot: "bg-green-500",
    label: "Invoice Paid"
  },
  scheduled: {
    bg: "bg-teal-50",
    text: "text-teal-700",
    dot: "bg-teal-500",
    label: "Scheduled"
  },
  pending_materials: {
    bg: "bg-purple-100",
    text: "text-purple-800",
    dot: "bg-purple-500",
    label: "Quote Pending Materials"
  },
  ho_rejected: {
    bg: "bg-red-50",
    text: "text-red-700",
    dot: "bg-red-500",
    label: "HO Rejected"
  },
  on_hold: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
    label: "On Hold (Boneyard)"
  }
};

export default function StatusBadge({ status, size = "default" }) {
  const config = statusConfig[status] || statusConfig.draft;
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium",
      config.bg,
      config.text,
      size === "small" ? "px-2 py-0.5 text-xs" : size === "large" ? "px-5 py-2.5 text-2xl" : "px-3 py-1 text-sm"
    )}>
      <span className={cn("rounded-full", config.dot, size === "small" ? "w-1.5 h-1.5" : size === "large" ? "w-3.5 h-3.5" : "w-2 h-2")} />
      {config.label}
    </span>
  );
}