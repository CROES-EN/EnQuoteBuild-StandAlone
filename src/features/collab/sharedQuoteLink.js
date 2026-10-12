export class SharedQuoteAmbiguityError extends Error {
  constructor(message, candidates) {
    super(message);
    this.name = "SharedQuoteAmbiguityError";
    this.candidates = candidates;
  }
}

function resolveReferenceMatches(matches) {
  if (matches.length <= 1) return matches[0] || null;
  const current = matches.filter(quote => quote.is_current_version !== false);
  if (current.length === 1) return current[0];
  throw new SharedQuoteAmbiguityError(
    "This quote reference matches multiple records. Select the quote below to open it.",
    current.length ? current : matches
  );
}

export async function resolveSharedQuote(id, quoteNumber, {getQuoteById, getQuotes}) {
  const exact = id ? await getQuoteById(id) : null;
  if (exact) return exact;
  if (!id && !quoteNumber) return null;
  const quotes = await getQuotes();
  const aliases = id ? quotes.filter(quote => String(quote.id) === String(id) ||
    (quote.base44_id != null && String(quote.base44_id) === String(id))) : [];
  if (aliases.length > 1) throw new SharedQuoteAmbiguityError(
    "This shared quote ID matches multiple records. Select the quote below to open it.", aliases);
  if (aliases.length === 1) return aliases[0];
  const reference = quoteNumber || quoteReferenceFromLabel(id);
  if (!reference) return null;
  const normalized = reference.trim().toUpperCase();
  const matches = quotes.filter(quote => typeof quote.quote_number === "string" &&
    quote.quote_number.trim().toUpperCase() === normalized);
  return resolveReferenceMatches(matches);
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
import {APP_LINK_QUERY, quoteReferenceFromLabel} from "../../../shared/appLinkRules.js";
