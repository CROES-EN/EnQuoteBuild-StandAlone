const INVOICED_STATUSES = new Set(["invoiced", "invoice_paid", "invoice_paid_materials_required"]);

/** True once a quote has been invoiced (or already carries an invoice number). */
export function showsInvoiceNumber(quote) {
  return Boolean(quote?.invoice_number || quote?.invoiced_date || INVOICED_STATUSES.has(quote?.status));
}

export function canEditQuoteRecord(quote, user, {isApprover = false, isAdmin = false} = {}) {
  if (isApprover || isAdmin) return true;
  if (!quote || !user) return false;
  const creatorEmail = quote.created_by_email ||
    quote.status_history?.find((entry) => entry.entry_type !== "follow_up")?.changed_by ||
    quote.created_by;
  return quote.created_by_id === user.id ||
    Boolean(creatorEmail && user.email && creatorEmail.toLowerCase() === user.email.toLowerCase());
}

/** Update payload for correcting an invoice number; null when nothing would change. */
export function buildInvoiceNumberEdit(quote, nextValue, changedBy) {
  const invoiceNumber = String(nextValue || "").trim();
  const previous = quote?.invoice_number || "";
  if (!invoiceNumber || invoiceNumber === previous) return null;
  return {
    invoice_number: invoiceNumber,
    status_history: [
      ...(quote?.status_history || []),
      {
        status: quote?.status,
        changed_by: changedBy,
        changed_at: new Date().toISOString(),
        reason: `Invoice number changed from ${previous || "not recorded"} to ${invoiceNumber}`
      }
    ]
  };
}
