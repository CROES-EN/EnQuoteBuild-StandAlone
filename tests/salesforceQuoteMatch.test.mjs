import test from "node:test";
import assert from "node:assert/strict";
import {matchSalesforceQuotes} from "../src/features/quotes/salesforceQuoteMatch.js";

const quote = {id: "q1", case_number: "20423783", site_id: "1728655"};
const context = {caseNumber: "20423783", siteId: "1728655", contactName: "Homeowner"};

test("matches current quotes by exact case and checks site, including leading zeros", () => {
  assert.deepEqual(matchSalesforceQuotes([quote], context).matches, [quote]);
  assert.deepEqual(matchSalesforceQuotes([{...quote, case_number: "020423783"}], context).matches.map(q => q.id), ["q1"]);
  assert.equal(matchSalesforceQuotes([{...quote, is_current_version: false}], context).matches.length, 0);
  assert.equal(matchSalesforceQuotes([{...quote, site_id: "999"}], context).matches.length, 0);
});

test("falls back to site only without case matches and does not guess among multiple quotes", () => {
  assert.equal(matchSalesforceQuotes([{...quote, case_number: "99"}], context).matchedBy, "site");
  assert.equal(matchSalesforceQuotes([quote], {...context, caseNumber: ""}).matches.length, 0);
  assert.equal(matchSalesforceQuotes([quote, {...quote, id: "q2"}], context).matches.length, 2);
  assert.match(matchSalesforceQuotes([quote, {...quote, id: "q2"}], context).message, /Multiple/);
  assert.deepEqual(matchSalesforceQuotes([quote, {...quote, id: "other-case", case_number: "99"}], context).matches, [quote]);
  assert.equal(matchSalesforceQuotes([{...quote, case_number: "99"}, {...quote, id: "q2", case_number: "98"}], context).matches.length, 2);
  assert.equal(matchSalesforceQuotes([{...quote, site_id: "999"}, {...quote, id: "site-match", case_number: "99"}], context).matches.length, 0, "conflicting case match must not fall back to site");
  assert.equal(matchSalesforceQuotes([], context).message, "No Quote Found");
});
