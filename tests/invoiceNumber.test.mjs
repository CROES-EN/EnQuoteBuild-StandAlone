import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceNumberEdit,
  hydrateInvoiceNumbers,
  invoiceNumberFromHistory,
  resolveInvoiceNumber
} from "../src/features/quotes/invoiceNumber.js";

const synced = {
  id: "q1",
  status: "invoiced",
  status_history: [
    {status: "approved", changed_at: "2026-10-14T20:00:00.000Z", reason: "Approved"},
    {status: "invoiced", changed_at: "2026-10-14T22:06:00.328Z", reason: "Invoice number changed from not recorded to MC15XKE7-0001"}
  ]
};

test("recovers invoice number Base44 stripped from the record", () => {
  assert.equal(resolveInvoiceNumber(synced), "MC15XKE7-0001");
  assert.equal(hydrateInvoiceNumbers(synced).invoice_number, "MC15XKE7-0001");
  assert.equal(hydrateInvoiceNumbers([synced])[0].invoice_number, "MC15XKE7-0001");
});

test("uses the most recent history entry, including Mark as Invoiced entries", () => {
  assert.equal(invoiceNumberFromHistory([
    {changed_at: "2026-10-15T10:00:00.000Z", reason: "Invoice number changed from A-1 to B-2"},
    {changed_at: "2026-10-14T10:00:00.000Z", reason: "Invoice number A-1"}
  ]), "B-2");
  assert.equal(invoiceNumberFromHistory([{reason: "Invoice number INV-9"}]), "INV-9");
  assert.equal(invoiceNumberFromHistory([{reason: "Status changed"}]), "");
});

test("keeps an explicit invoice_number and leaves other records untouched", () => {
  const quote = {...synced, invoice_number: "LIVE-1"};
  assert.equal(hydrateInvoiceNumbers(quote), quote);
  const plain = {id: "q2", status_history: []};
  assert.equal(hydrateInvoiceNumbers(plain), plain);
  assert.equal(hydrateInvoiceNumbers(null), null);
});

test("edits compare against the recovered invoice number", () => {
  assert.equal(buildInvoiceNumberEdit(synced, "MC15XKE7-0001", "a@b.com"), null);
  const edit = buildInvoiceNumberEdit(synced, "NEW-2", "a@b.com");
  assert.match(edit.status_history.at(-1).reason, /from MC15XKE7-0001 to NEW-2/);
  assert.equal(invoiceNumberFromHistory(edit.status_history), "NEW-2");
});
