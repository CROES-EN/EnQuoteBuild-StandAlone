import {useEffect, useState} from "react";
import {Sheet, SheetContent, SheetHeader, SheetTitle} from "@/components/ui/sheet";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {AlertTriangle, CheckCircle2, Package, Trash2, UserCheck, UserX} from "lucide-react";
import {toast} from "sonner";
import {createLocalRecord, getCurrentUser, listLocalCollection} from "@/api/dataClient";
import {calculateQuoteTotals} from "@/utils/quoteCalculations";

/**
 * Bulk "Order Materials" review sheet - opened from Quote Details when a quote is
 * in the "invoice_paid_materials_required" status. Pre-fills one draft material
 * order row per quote line item (ALL items included by default, per explicit
 * request), each editable/removable before one "Submit All" action creates the
 * real material order records and hands control back to the parent (which moves
 * the quote to "materials_pending_shipment").
 *
 * Pricing model: Qty x Unit Price = Total, matching MaterialOrderForm.jsx and the
 * quote's own line items - Total is always computed, never independently entered.
 *
 * Reconciliation: the sum of every remaining row's Total is compared live against
 * the quote's own "Line Items Subtotal" (parts only - no labor/travel/mileage/tax,
 * via calculateQuoteTotals(quote).itemsSubtotal) so a mismatch is visible BEFORE
 * submitting, not discovered after the fact.
 */
// Normalizes a name for comparison - trims whitespace, collapses repeated internal
// spaces, and lowercases, so "Brandon Eymann", " Brandon  Eymann ", and "BRANDON EYMANN"
// all match the same FST roster entry.
function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Matches a quote's "FST Requester" (quote_requester) against the FST roster by exact
// (normalized) name. Per explicit finding: this field sometimes contains a homeowner's
// or someone else's name instead of a real technician - in that case this correctly
// returns null rather than guessing, so the caller can show a clear "no match" state
// instead of silently defaulting to a wrong address.
function matchFSTByName(requesterName, fsts) {
  const target = normalizeName(requesterName);
  if (!target) return null;
  return fsts.find((fst) => normalizeName(fst.name) === target) || null;
}

export default function BulkMaterialOrderReviewSheet({ open, onOpenChange, quote, onSubmitted }) {
  const [rows, setRows] = useState([]);
  const [shippingAddress, setShippingAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fsts, setFsts] = useState([]);

  // Loaded once whenever the sheet is opened - the FST roster is small (dozens of
  // records, not thousands), so a fresh fetch per open is cheap and always current
  // (e.g. if an address was just corrected in Resource Planner moments ago).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listLocalCollection("fsts");
        if (!cancelled) setFsts(Array.isArray(list) ? list.filter((fst) => !fst.is_deleted) : []);
      } catch {
        if (!cancelled) setFsts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // (Re)build the draft rows from the quote's line items every time the sheet is
  // opened for a given quote - each row starts as an exact reflection of one quote
  // line item (name/quantity/unit price), left fully editable/removable from here.
  useEffect(() => {
    if (open && quote) {
      const items = Array.isArray(quote.items) ? quote.items : [];
      setRows(
        items.map((item, index) => ({
          key: `${quote.id || "quote"}-${index}`,
          item_name: item.name || "",
          sku: item.sku || "",
          quantity: item.quantity || 1,
          unit_price: item.unit_price ?? 0,
          // Pre-filled from the quote's Scope of Work for clearer labeling on the
          // material order (per explicit request) - fully editable per row, saved as
          // each order's "notes" field (same field MaterialOrderForm.jsx/
          // MaterialOrders.jsx already use for "what is this item for").
          description: quote.scope_of_work || ""
        }))
      );
      // Auto-fill Ship To from the matched FST's shipping address (per explicit
      // request) - falls back to quote.shipping_address (if that field is ever
      // populated by some other means) and finally to blank, so a non-technician name
      // (a homeowner, etc.) correctly leaves this for manual entry instead of guessing.
      const matched = matchFSTByName(quote.quote_requester, fsts);
      setShippingAddress(matched?.shipping_address || quote.shipping_address || "");
    }
  }, [open, quote, fsts]);

  function updateRow(key, patch) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  const rowsWithTotals = rows.map((row) => {
    const quantity = Number(row.quantity) || 0;
    const unitPrice = Number(row.unit_price) || 0;
    return { ...row, quantity, unitPrice, total: quantity * unitPrice };
  });

  const draftTotal = rowsWithTotals.reduce((sum, row) => sum + row.total, 0);

  // "Line Items Subtotal" - parts only, no labor/travel/mileage/tax - the same
  // value already shown in QuoteForm.jsx's/QuoteDetails.jsx's own totals summary,
  // reused here directly rather than recalculated separately so the two numbers
  // can never define "items subtotal" two different ways.
  const { itemsSubtotal } = quote ? calculateQuoteTotals(quote) : { itemsSubtotal: 0 };
  const isReconciled = Math.abs(draftTotal - itemsSubtotal) < 0.01;

  async function handleSubmitAll() {
    if (!quote || rowsWithTotals.length === 0) return;
    setSubmitting(true);
    try {
      const currentUser = await getCurrentUser();
      const now = new Date().toISOString();
      await Promise.all(
        rowsWithTotals.map((row) =>
          createLocalRecord("materialOrders", {
            quote_id: quote.id,
            site_id: quote.site_id,
            item_name: row.item_name,
            sku: row.sku,
            quantity: row.quantity,
            unit_price: row.unitPrice,
            total: row.total,
            notes: row.description,
            shipping_address: shippingAddress,
            status: "submitted",
            submitted_date: now,
            status_history: [{ status: "submitted", changed_by: currentUser.email, changed_at: now }]
          })
        )
      );
      toast.success(`${rowsWithTotals.length} material order(s) submitted`);
      onSubmitted?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to submit bulk material orders:", error);
      toast.error("Could not submit material orders - see console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            Order Materials {quote?.site_id ? `- ${quote.site_id}` : ""}
          </SheetTitle>
        </SheetHeader>

        <p className="text-sm text-muted-foreground mt-2">
          Every line item from this quote is included below by default. Remove any row that
          shouldn't be ordered, and adjust quantity/unit price/SKU as needed, before submitting.
        </p>

        <div className="mt-4">
          <Label htmlFor="bulk_shipping_address">Ship To</Label>
          {(() => {
            const matched = matchFSTByName(quote?.quote_requester, fsts);
            if (!quote?.quote_requester) return null;
            return matched ? (
              <p className="mt-1 mb-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                Matched FST Requester "{quote.quote_requester}" to {matched.name} - address pre-filled below.
              </p>
            ) : (
              <p className="mt-1 mb-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                <UserX className="w-3.5 h-3.5 shrink-0" />
                No FST in the roster matches "{quote.quote_requester}" (may be a homeowner or other name) - enter the shipping address manually below.
              </p>
            );
          })()}
          <Textarea
            id="bulk_shipping_address"
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            placeholder="Full shipping address for this order"
            rows={2}
            className="mt-1.5"
          />
        </div>

        <div className="mt-4 space-y-3">
          {rowsWithTotals.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No line items remain - nothing to submit.
            </p>
          ) : (
            rowsWithTotals.map((row) => (
              <div key={row.key} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Input
                    value={row.item_name}
                    onChange={(e) => updateRow(row.key, { item_name: e.target.value })}
                    placeholder="Item name"
                    className="font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-rose-600 shrink-0"
                    onClick={() => removeRow(row.key)}
                    title="Remove this line item from the order"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    value={row.description}
                    onChange={(e) => updateRow(row.key, { description: e.target.value })}
                    placeholder="What is this item for? (pre-filled from Scope of Work)"
                    rows={2}
                    className="mt-1 text-sm"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2 items-end">
                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input
                      value={row.sku}
                      onChange={(e) => updateRow(row.key, { sku: e.target.value })}
                      placeholder="Optional"
                      className="mt-1 h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      min="1"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      className="mt-1 h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Unit Price ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.unitPrice}
                      onChange={(e) => updateRow(row.key, { unit_price: e.target.value })}
                      className="mt-1 h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Total</Label>
                    <div className="mt-1 h-8 flex items-center px-2 rounded-md border border-border bg-muted text-sm font-semibold">
                      ${row.total.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Reconciliation check - compares the sum of every remaining row's Total against the
            quote's own Line Items Subtotal (parts only). */}
        <div
          className={
            isReconciled
              ? "mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700"
              : "mt-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700"
          }
        >
          {isReconciled ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>
            Draft order total: <strong>${draftTotal.toFixed(2)}</strong> - Quote's Line Items Subtotal:{" "}
            <strong>${itemsSubtotal.toFixed(2)}</strong>
            {isReconciled ? " - matches." : " - review before submitting (expected if you removed/edited a row)."}
          </span>
        </div>

        <div className="flex gap-3 pt-4 mt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || rowsWithTotals.length === 0}
            onClick={handleSubmitAll}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {submitting ? "Submitting..." : `Submit All (${rowsWithTotals.length})`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}