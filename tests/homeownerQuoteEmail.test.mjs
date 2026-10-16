import test from "node:test";
import assert from "node:assert/strict";
import {homeownerQuoteEmail} from "../src/features/quotes/homeownerQuoteEmail.js";

test("email follows the personal service-quote style using sender and customer scope", () => {
  const email = homeownerQuoteEmail({
    quote_number: "Q-123", site_id: "123", picklist: "On-Demand",
    items: [{name: "INTERNAL PART", total: 100}], internal_notes: "SECRET NOTES",
    scope_of_work: "INTERNAL SCOPE"
  }, "Linda", {siteId: "789"}, {
    senderName: "Carsten Roeschberger",
    scopeSummary: "Your system needs approximately 25 feet of wiring and a 60 amp disconnect replaced."
  });
  assert.equal(email.split("\n")[0], "Subject: Enphase Energy - On - Demand Quote - Linda - 789");
  assert.match(email, /Hello Linda,/);
  assert.match(email, /This is Carsten with Enphase Energy\./);
  assert.match(email, /an On-Demand service quote/);
  assert.match(email, /25 feet of wiring and a 60 amp disconnect replaced/);
  assert.match(email, /I have attached the service quote to this email for you to review\./);
  assert.match(email, /please let me know so I can have an invoice sent to you\./);
  assert.doesNotMatch(email, /SECRET|INTERNAL|Subtotal|Total quoted|scheduled|payment due/);
});

test("missing summary does not expose raw scope or invent work, identity or quote type", () => {
  const email = homeownerQuoteEmail({scope_of_work: "PRIVATE TECHNICIAN NOTES"}, "Jane\nDoe");
  assert.equal(email.split("\n")[0], "Subject: Enphase Energy - On - Demand Quote - Jane Doe");
  assert.match(email, /Hello Jane Doe,/);
  assert.match(email, /put together a service quote/);
  assert.doesNotMatch(email, /PRIVATE|This is|On-Demand|proposed work is as follows/);
  assert.doesNotMatch(homeownerQuoteEmail({}, "Jane", null, {senderName: "agent@example.com"}), /This is|agent@example.com/);
  assert.throws(() => homeownerQuoteEmail(null, "Jane"), /quote is required/);
  assert.throws(() => homeownerQuoteEmail({}, ""), /homeowner name/);
});

test("subject and greeting reuse the PDF homeowner selection, not a saved or Salesforce name", () => {
  const email = homeownerQuoteEmail({client_name: "Saved Name", site_id: "00123"},
    "Manual Homeowner", {contactName: "Salesforce Contact", siteId: ""});
  assert.equal(email.split("\n")[0], "Subject: Enphase Energy - On - Demand Quote - Manual Homeowner - 00123");
  assert.match(email, /Hello Manual Homeowner,/);
  assert.doesNotMatch(email, /Saved Name|Salesforce Contact/);
});
