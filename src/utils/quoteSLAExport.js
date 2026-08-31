const formatTimestamp = (value) => {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
};

const escapeCell = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const statusTimestamp = (quote, status, directField) => {
  return quote[directField] || quote.status_history?.find((entry) => entry.status === status)?.changed_at || "";
};

export function exportQuoteSLAToExcel(quotes) {
  const headers = [
    "Quote ID", "Quote Number", "Site ID", "Case Number", "Requester", "Owner", "Current Status",
    "Created (MT)", "Submitted (MT)", "Approved (MT)", "Rejected (MT)", "Sent to HO (MT)",
    "HO Approved (MT)", "HO Rejected (MT)", "Invoiced (MT)", "Invoice Paid (MT)", "Scheduled (MT)",
    "Last Updated (MT)", "Status Timeline (MT)"
  ];

  const rows = quotes.map((quote) => [
    quote.id, quote.quote_number, quote.site_id, quote.case_number, quote.quote_requester, quote.owner_email, quote.status,
    formatTimestamp(quote.created_date),
    formatTimestamp(statusTimestamp(quote, "submitted", "submitted_date")),
    formatTimestamp(statusTimestamp(quote, "approved", "approved_date")),
    formatTimestamp(statusTimestamp(quote, "rejected", "")),
    formatTimestamp(statusTimestamp(quote, "quote_sent_to_ho", "quote_sent_to_ho_date")),
    formatTimestamp(statusTimestamp(quote, "ho_approved_invoice_required", "ho_approved_date")),
    formatTimestamp(statusTimestamp(quote, "ho_rejected", "ho_rejected_date")),
    formatTimestamp(statusTimestamp(quote, "invoiced", "invoiced_date")),
    formatTimestamp(statusTimestamp(quote, "invoice_paid", "invoice_paid_date")),
    formatTimestamp(statusTimestamp(quote, "scheduled", "scheduled_date")),
    formatTimestamp(quote.updated_date),
    (quote.status_history || []).map((entry) => `${formatTimestamp(entry.changed_at)} — ${entry.status}${entry.reason ? `: ${entry.reason}` : ""}`).join(" | ")
  ]);

  const table = `<table><tr>${headers.map((header) => `<th style="background:#4f46e5;color:#fff;padding:8px;border:1px solid #ddd;white-space:nowrap;text-align:left">${header}</th>`).join("")}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td style="padding:8px;border:1px solid #ddd;vertical-align:top">${escapeCell(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quote_sla_timestamps_${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}