import {computeQuoteAlert, userHasAlertAccess} from "../../utils/quoteSLA.js";

export function selectQuoteAlerts(quotes, dismissals, mentions, email, isAdmin) {
  const dismissed = new Set(dismissals.map(item => item.quote_id));
  const mentioned = new Set(mentions.filter(item => item.mentioned_email === email && !item.is_resolved).map(item => item.quote_id));
  return quotes.filter(quote => !dismissed.has(quote.id) &&
    (userHasAlertAccess(computeQuoteAlert(quote), quote, email, isAdmin) || mentioned.has(quote.id)));
}
