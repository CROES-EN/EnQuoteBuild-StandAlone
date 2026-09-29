import {cn} from "@/lib/utils";

const statusConfig = {
  draft_without_internal: {
    bg: "bg-muted",
    text: "text-foreground",
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
    bg: "bg-muted",
    text: "text-foreground",
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
  invoice_paid_materials_required: {
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    dot: "bg-cyan-500",
    label: "Invoice Paid - Materials Required"
  },
  materials_pending_shipment: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    dot: "bg-sky-500",
    label: "Materials Pending Shipment"
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
  },
  // Used ONLY by Auto-Drafter (src/components/autoDrafter/AutoDrafterCaseTile.jsx) for
  // AI-generated drafts saved via autoDrafterDraftsStore.js. Never a real quote status.
  ai_generated_quote_needs_review: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    dot: "bg-violet-500",
    label: "AI Generated Quote - Needs Review"
  }
};

// FIX: previously fell back to statusConfig.draft for ANY unrecognized status -
// actively misleading (a real, different status would render looking exactly like
// a fresh untouched draft). Now generates a neutral, honest label from the raw
// status text instead of pretending it's something it isn't.
function humanizeUnknownStatus(status) {
  return String(status || "unknown")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function StatusBadge({ status, size = "default" }) {
  const config = statusConfig[status] || {
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    label: humanizeUnknownStatus(status)
  };
  
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