const id = value => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : "";
};

export function matchSalesforceQuotes(quotes, context) {
  const caseNumber = id(context?.caseNumber);
  const siteId = id(context?.siteId);
  if (!caseNumber) return {matches: [], message: "No Salesforce case number was detected. Select a quote manually."};
  const current = quotes.filter(quote => quote.is_current_version !== false);
  let matches = current.filter(quote => id(quote.case_number) === caseNumber);
  if (siteId && matches.some(quote => id(quote.site_id) && id(quote.site_id) !== siteId)) {
    return {matches: [], message: "The Salesforce case matches quotes with a different Site ID. Select and verify the quote manually."};
  }
  const matchedBy = matches.length ? "case" : "site";
  if (!matches.length && siteId) matches = current.filter(quote => id(quote.site_id) === siteId);
  if (!matches.length) return {matches, message: "No Quote Found", matchedBy: null};
  return {
    matches, matchedBy,
    message: matches.length === 1 ? `Matched one quote by Salesforce ${matchedBy === "case" ? "case number" : "Site ID"}. Verify the quote and homeowner before preparing.`
      : `Multiple current quotes match this Salesforce ${matchedBy}. Select the correct quote below.`
  };
}
