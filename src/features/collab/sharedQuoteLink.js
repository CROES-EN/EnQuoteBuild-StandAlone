export async function resolveSharedQuote(id, quoteNumber, {getQuoteById, getQuotes}) {
  const exact = id ? await getQuoteById(id) : null;
  if (exact) return exact;
  if (!id && !quoteNumber) return null;
  const quotes = await getQuotes();
  const aliases = id ? quotes.filter(quote => quote.id === id || quote.base44_id === id) : [];
  if (aliases.length > 1) throw new Error("This shared quote ID matches multiple records. Open the quote from Quotes instead.");
  if (aliases.length === 1) return aliases[0];
  if (!quoteNumber) return null;
  const matches = quotes.filter(quote => quote.quote_number === quoteNumber);
  if (matches.length > 1) throw new Error("This quote reference matches multiple records. Open the quote from Quotes instead.");
  return matches[0] || null;
}

export function canonicalSharedQuotePath(pathname, search, requestedId, quote) {
  const params = new URLSearchParams(search);
  params.set("id", quote.id);
  const value = params.get(APP_LINK_QUERY);
  if (value) {
    // Preserve the selected section when the sender and recipient use different local IDs.
    let target;
    try { target = JSON.parse(value); } catch { return `${pathname}?${params}`; }
    const prefix = `quote:${requestedId}`;
    if (target?.kind === "record" && typeof target.value === "string" &&
        (target.value === prefix || target.value.startsWith(`${prefix}:`))) {
      params.set(APP_LINK_QUERY, JSON.stringify({...target, value: `quote:${quote.id}${target.value.slice(prefix.length)}`}));
    }
  }
  return `${pathname}?${params}`;
}
import {APP_LINK_QUERY} from "../../../shared/appLinkRules.js";
