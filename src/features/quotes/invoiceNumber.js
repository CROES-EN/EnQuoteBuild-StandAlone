const INVOICED_STATUSES = new Set(["invoiced", "invoice_paid", "invoice_paid_materials_required"]);

const HISTORY_INVOICE_PATTERN = /^Invoice number (?:changed from .+? to )?(\S.*)$/;

/**
 * Base44 has no invoice_number column, so a sync round-trip strips the field. The
 * status_history entry written alongside every invoice-number save does survive, so
 * the most recent one is the durable source of truth when the field is missing.
 */
export function invoiceNumberFromHistory(history) {
  if (!Array.isArray(history)) return "";
  let latest = null;
  let latestTime = -Infinity;
  history.forEach((entry, index) => {
    const match = typeof entry?.reason === "string" ? entry.reason.trim().match(HISTORY_INVOICE_PATTERN) : null;
    if (!match) return;
    const parsed = Date.parse(entry.changed_at);
    const time = Number.isNaN(parsed) ? index : parsed;
    if (time >= latestTime) {
      latestTime = time;
      latest = match[1].trim();
    }
  });
  return latest || "";
}

export function resolveInvoiceNumber(quote) {
  return String(quote?.invoice_number || "").trim() || invoiceNumberFromHistory(quote?.status_history);
}

/** Restores invoice_number from status_history on quote records (or arrays of them). */
export function hydrateInvoiceNumbers(value) {
  if (Array.isArray(value)) return value.map(hydrateInvoiceNumbers);
  if (!value || typeof value !== "object" || value.invoice_number || !Array.isArray(value.status_history)) return value;
  const invoiceNumber = invoiceNumberFromHistory(value.status_history);
  return invoiceNumber ? {...value, invoice_number: invoiceNumber} : value;
}

/** True once a quote has been invoiced (or already carries an invoice number). */
export function showsInvoiceNumber(quote) {
  return Boolean(resolveInvoiceNumber(quote) || quote?.invoiced_date || INVOICED_STATUSES.has(quote?.status));
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
  const previous = resolveInvoiceNumber(quote);
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
