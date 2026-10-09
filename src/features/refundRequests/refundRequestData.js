export function sortRefundRequests(requests) {
  return [...requests].sort((a, b) => {
    const left = Date.parse(a.submittedAt || "");
    const right = Date.parse(b.submittedAt || "");
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return right - left;
  });
}

export function filterRefundRequests(requests, filters) {
  const query = filters.search.trim().toLocaleLowerCase();
  const from = filters.submittedFrom ? new Date(`${filters.submittedFrom}T00:00:00`).getTime() : null;
  const through = filters.submittedThrough ? new Date(`${filters.submittedThrough}T23:59:59.999`).getTime() : null;
  return sortRefundRequests(requests).filter((request) => {
    if (query && ![
      request.subscriptionId,
      request.siteId,
      request.customerName,
      request.requestorName,
      request.requestorEmail
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query))) return false;
    if (filters.status && request.status !== filters.status) return false;
    if (filters.department && request.requestorDepartment !== filters.department) return false;
    if (filters.refundType && request.refundType !== filters.refundType) return false;
    if (filters.approvalRequired !== "" &&
        Boolean(request.leadershipApprovalRequired) !== (filters.approvalRequired === "yes")) return false;
    const submitted = Date.parse(request.submittedAt || "");
    if (from != null && (!Number.isFinite(submitted) || submitted < from)) return false;
    if (through != null && (!Number.isFinite(submitted) || submitted > through)) return false;
    return true;
  });
}

export function formatRefundAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function formatRefundDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
export const REFUND_REQUEST_STATUSES = [
  "Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled"
];

export function normalizeRefundStatus(status) {
  return ({New: "Submitted", Processed: "Completed", Closed: "Completed"})[status] || status || "Submitted";
}
