/**
 * SINGLE SOURCE OF TRUTH for every known quote status - value, display label, and
 * Base44-sync metadata.
 *
 * WHY THIS FILE EXISTS: before this file, the status list was copy-pasted
 * independently across StatusBadge.jsx, Quotes.jsx, QuoteOverview.jsx,
 * QuoteDetails.jsx, and quoteOpsMetrics.js - with nothing keeping them in sync.
 * This is exactly how "invoice_paid_materials_required"/"materials_pending_shipment"
 * ended up missing from the Quotes.jsx filter bar for a while after being added
 * everywhere else - a real, confirmed drift bug, not hypothetical.
 *
 * This file does not yet REPLACE those 5 files' own copies (a full refactor of all
 * 5 call sites is a larger, separate change) - it's the reference
 * Audit-StatusReconciliation.cjs checks every other file against, so the SAME
 * drift is caught immediately going forward instead of discovered later via a UI
 * symptom.
 *
 * `knownToBase44`: whether this status is CONFIRMED to exist in Base44's own Quote
 * entity schema. Base44 does NOT strictly enforce its status enum on write
 * (confirmed empirically: a quote with status "materials_pending_shipment" synced
 * successfully with no error, even though that value doesn't yet exist in Base44's
 * own dashboard/schema) - so `knownToBase44: false` does NOT mean sync will fail,
 * it means Base44's OWN UI may not display/filter this status correctly until its
 * schema is updated to match (see the companion Base44-Status-Sync-Prompt.txt for
 * the exact text to paste into Base44 to do that).
 */

export const QUOTE_STATUSES = [
  { value: "draft_without_internal", label: "Quote Draft", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "draft", label: "Quote Draft", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "draft_without_fst", label: "Quote Missing Details", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "submitted", label: "Quote Pending Approval", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "approved", label: "Quote Approved", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "rejected", label: "Rejected", knownToBase44: true, isTerminal: true, isCompleted: false },
  { value: "quote_sent_to_ho", label: "Quote Sent to HO", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "ho_approved_invoice_required", label: "HO Approved, Invoice Required", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "ho_rejected", label: "HO Rejected", knownToBase44: true, isTerminal: true, isCompleted: false },
  { value: "invoiced", label: "Quote Pending Payment", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "invoice_paid", label: "Invoice Paid", knownToBase44: true, isTerminal: true, isCompleted: true },
  { value: "travel_plan_needed", label: "Travel Plan Needed", knownToBase44: true, isTerminal: false, isCompleted: false },
  { value: "pending_materials", label: "Pending Materials", knownToBase44: true, isTerminal: false, isCompleted: false },
  // --- New statuses added for the materials-ordering workflow - NOT YET confirmed
  // present in Base44's own Quote status schema/picklist. See the companion prompt
  // file for the exact text to add them there so Base44's own UI understands them
  // too, not just accepts them as loose text.
  { value: "invoice_paid_materials_required", label: "Invoice Paid - Materials Required", knownToBase44: false, isTerminal: true, isCompleted: true },
  { value: "materials_pending_shipment", label: "Materials Pending Shipment", knownToBase44: false, isTerminal: true, isCompleted: true },
  { value: "scheduled", label: "Scheduled", knownToBase44: true, isTerminal: true, isCompleted: true },
  { value: "on_hold", label: "Boneyard (On Hold)", knownToBase44: true, isTerminal: false, isCompleted: false },
  // Auto-Drafter-only pseudo-status - never a real quote status, never sent to Base44.
  { value: "ai_generated_quote_needs_review", label: "AI Generated Quote - Needs Review", knownToBase44: false, isTerminal: false, isCompleted: false, localOnly: true }
];

export const QUOTE_STATUS_VALUES = QUOTE_STATUSES.map((s) => s.value);
export const TERMINAL_STATUS_VALUES = QUOTE_STATUSES.filter((s) => s.isTerminal).map((s) => s.value);
export const COMPLETED_STATUS_VALUES = QUOTE_STATUSES.filter((s) => s.isCompleted).map((s) => s.value);
export const STATUSES_NOT_YET_IN_BASE44 = QUOTE_STATUSES.filter((s) => !s.knownToBase44 && !s.localOnly).map((s) => s.value);

export function getStatusLabel(value) {
  const match = QUOTE_STATUSES.find((s) => s.value === value);
  return match ? match.label : null;
}