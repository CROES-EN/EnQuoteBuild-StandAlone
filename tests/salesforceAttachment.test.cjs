const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const helpers = import("../shared/customerQuoteFilename.js");
const {createSalesforceAttachment} = require("../electron/salesforceAttachment.cjs");

test("homeowner filenames are safe and retain quote identity", async () => {
  const {customerQuoteFilename} = await helpers;
  assert.equal(customerQuoteFilename(" Jane / Doe ", "Q-123"), "Jane Doe - Quote - Q-123.pdf");
  assert.equal(customerQuoteFilename("CON", ""), "CON - Quote.pdf");
  assert.equal(customerQuoteFilename("Zoë Smith", "Q-1"), "Zoë Smith - Quote - Q-1.pdf");
  assert.throws(() => customerQuoteFilename("...", "Q-1"), /homeowner/);
});

test("homeowner names prefill from standard quotes and Auto-Drafter customer fields", async () => {
  const {quoteHomeownerName} = await helpers;
  assert.equal(quoteHomeownerName({client_name: " Jane Doe ", customer: "Different Name"}), "Jane Doe");
  assert.equal(quoteHomeownerName({customer: "Sam Smith"}), "Sam Smith");
  assert.equal(quoteHomeownerName({client_name: "   ", customer: "Sam Smith"}), "Sam Smith");
  assert.equal(quoteHomeownerName({client_name: "...", customer: "Sam Smith"}), "Sam Smith");
  assert.equal(quoteHomeownerName({customer: {name: "Not a string"}}), "");
  assert.equal(quoteHomeownerName({site_id: "123", quote_requester: "Agent Name"}), "");
  assert.equal(quoteHomeownerName(null), "");
});

test("prepared PDFs support native drag and folder selection without sending or uploading", async () => {
  const calls = [];
  let copied = "";
  const service = createSalesforceAttachment({
    nativeImage: {createFromBitmap: pixels => {
      assert.equal(pixels.length, 32 * 32 * 4);
      return "drag-icon";
    }},
    shell: {showItemInFolder: file => calls.push(file)},
    clipboard: {writeText: text => {copied = text;}}
  });
  let dragged;
  try {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\ncustomer copy"));
    await assert.rejects(service.prepare({name: "Jane", bytes}, ""), /Sign in/);
    await assert.rejects(service.prepare({name: "Jane", bytes: new Uint8Array([1, 2])}, "alice"), /valid/);
    const result = await service.prepare({name: "Jane Doe", reference: "Q-123", bytes, emailText: "Hello Jane, your quote is ready."}, "alice");
    assert.equal(result.filename, "Jane Doe - Quote - Q-123.pdf");
    assert.equal(service.state("bob"), null);
    assert.equal(service.state("alice").hasEmail, true);
    await assert.rejects(service.copyEmail("bob"), /account/);
    await service.copyEmail("alice");
    assert.equal(copied, "Hello Jane, your quote is ready.");
    assert.throws(() => service.drag({}, "bob"), /account/);
    service.drag({startDrag: item => {dragged = item;}}, "alice");
    assert.equal(dragged.icon, "drag-icon");
    assert.deepEqual(fs.readFileSync(dragged.file), Buffer.from(bytes));
    assert.equal(require("node:path").basename(dragged.file), result.filename);
    service.reveal("alice");
    assert.deepEqual(calls, [dragged.file]);
    service.clear("bob");
    assert.ok(service.state("alice"), "another owner cannot clear the prepared file");
    await assert.rejects(service.prepare({name: "Other", bytes}, "alice", () => false), /case changed/);
    assert.ok(service.state("alice"), "cancelled preparation does not replace the existing PDF");
    const pending = service.prepare({name: "Stale", bytes}, "alice");
    service.clear("alice");
    await assert.rejects(pending, /case changed/, "clearing invalidates pending preparation");
    assert.equal(service.state("alice"), null);
    await assert.rejects(service.copyEmail("alice"), /account/);
  } finally {
    service.clear();
  }
  assert.equal(fs.existsSync(dragged.file), false);
  assert.equal(service.state("alice"), null);
});
