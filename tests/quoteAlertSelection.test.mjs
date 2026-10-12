import test from "node:test";
import assert from "node:assert/strict";
import {selectQuoteAlerts} from "../src/features/quotes/quoteAlertSelection.js";
import {computeQuoteAlert, userHasAlertAccess} from "../src/utils/quoteSLA.js";

test("attention box and Alerts use identical SLA access, mention and dismissal rules", () => {
  const email = "owner@example.com";
  const quotes = [
    {id:"draft",status:"draft_without_internal",created_by:email,created_date:"2020-01-01",status_history:[]},
    {id:"other",status:"draft_without_internal",created_by:"other@example.com",created_date:"2020-01-01",status_history:[]},
    {id:"mention",status:"scheduled",created_by:"other@example.com"},
    {id:"dismissed",status:"draft_without_internal",created_by:email,created_date:"2020-01-01",status_history:[]}
  ];
  const dismissals = [{quote_id:"dismissed"}];
  const mentions = [{quote_id:"mention",mentioned_email:email,is_resolved:false},
    {quote_id:"other",mentioned_email:email,is_resolved:true}];
  const result = selectQuoteAlerts(quotes,dismissals,mentions,email,false);
  assert.deepEqual(result.map(q => q.id), ["draft","mention"]);
  const expected = quotes.filter(q => q.id !== "dismissed" &&
    (userHasAlertAccess(computeQuoteAlert(q),q,email,false) || q.id === "mention"));
  assert.deepEqual(result, expected);
  assert.deepEqual(selectQuoteAlerts(quotes,dismissals,mentions,email,true).map(q => q.id), ["draft","other","mention"]);
});
