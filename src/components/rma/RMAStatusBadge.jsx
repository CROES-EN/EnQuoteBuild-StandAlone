import { cn } from "@/lib/utils";

const statusConfig = {
  "New": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "Waiting for Customer": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "Reviewing Documentation": { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
  "RMA Submitted": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  "Manufacturer Reviewing": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  "Approved": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  "Rejected": { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  "Deadend": { bg: "bg-zinc-100", text: "text-zinc-700", dot: "bg-zinc-500" },
  "Replacement Pending Shipment": { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  "Replacement Shipped": { bg: "bg-cyan-50", text: "text-cyan-700", dot: "bg-cyan-500" },
  "Replacement Installed": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500" },
  "Closed": { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  "On Hold": { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" }
};

export default function RMAStatusBadge({ status, size = "default" }) {
  const config = statusConfig[status] || statusConfig["New"];
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
      config.bg, config.text, sizeClasses
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {status || "New"}
    </span>
  );
}