export const RMA_STATUSES = [
  "New",
  "Waiting for Customer",
  "Reviewing Documentation",
  "RMA Submitted",
  "Manufacturer Reviewing",
  "Approved",
  "Rejected",
  "Deadend",
  "Replacement Pending Shipment",
  "Replacement Shipped",
  "Replacement Installed",
  "Closed",
  "On Hold"
];

export const STATUS_COLORS = {
  "New": "#3b82f6",
  "Waiting for Customer": "#f59e0b",
  "Reviewing Documentation": "#6366f1",
  "RMA Submitted": "#8b5cf6",
  "Manufacturer Reviewing": "#7c3aed",
  "Approved": "#10b981",
  "Rejected": "#ef4444",
  "Deadend": "#71717a",
  "Replacement Pending Shipment": "#f97316",
  "Replacement Shipped": "#06b6d4",
  "Replacement Installed": "#14b8a6",
  "Closed": "#64748b",
  "On Hold": "#dc2626"
};

export function getDaysOpen(rma) {
  if (!rma?.created_date) return 0;
  const created = new Date(rma.created_date);
  const end = rma.current_status === "Closed" && rma.updated_date
    ? new Date(rma.updated_date)
    : new Date();
  return Math.max(0, Math.floor((end - created) / (1000 * 60 * 60 * 24)));
}

export function getDaysInCurrentStatus(rma) {
  if (!rma) return 0;
  const history = rma.status_history || [];
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  const start = lastEntry?.changed_at
    ? new Date(lastEntry.changed_at)
    : (rma.created_date ? new Date(rma.created_date) : new Date());
  return Math.max(0, Math.floor((new Date() - start) / (1000 * 60 * 60 * 24)));
}

export function getLastUpdated(rma) {
  return rma?.updated_date || rma?.created_date || null;
}