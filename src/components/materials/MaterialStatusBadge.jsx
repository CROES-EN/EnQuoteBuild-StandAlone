import { cn } from "@/lib/utils";

const statusConfig = {
  draft:     { bg: "bg-slate-100",   text: "text-slate-600",  dot: "bg-slate-400",  label: "Draft" },
  submitted: { bg: "bg-blue-100",    text: "text-blue-700",   dot: "bg-blue-500",   label: "Submitted" },
  approved:  { bg: "bg-emerald-100", text: "text-emerald-700",dot: "bg-emerald-500",label: "Approved" },
  ordered:   { bg: "bg-amber-100",   text: "text-amber-700",  dot: "bg-amber-500",  label: "Ordered" },
  complete:  { bg: "bg-purple-100",  text: "text-purple-700", dot: "bg-purple-500", label: "Complete" },
  rejected:  { bg: "bg-rose-100",    text: "text-rose-700",   dot: "bg-rose-500",   label: "Rejected" }
};

export default function MaterialStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", config.bg, config.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}