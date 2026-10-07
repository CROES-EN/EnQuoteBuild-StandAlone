const DRAFT_STATUSES = new Set(["draft", "draft_without_internal", "draft_without_fst", "ai_generated_quote_needs_review"]);

export function isEditableDraft(quote) {
  return !quote?.status || DRAFT_STATUSES.has(quote.status);
}

export async function saveQuoteEdit({quote, data, user, getQuotes, createQuote, updateQuote}) {
  if (!quote?.id) throw new Error("The quote must be loaded before saving.");
  if (isEditableDraft(quote)) {
    return updateQuote(quote.id, data, quote._rev);
  }
  const parentQuoteId = quote.parent_quote_id || quote.id;
  const versions = (await getQuotes()).filter(record => record.id === parentQuoteId || record.parent_quote_id === parentQuoteId);
  const version = Math.max(1, ...versions.map(record => record.version_number || 1)) + 1;
  const at = new Date().toISOString();
  const newQuote = await createQuote({
    ...data,
    quote_number: quote.quote_number,
    parent_quote_id: parentQuoteId,
    version_number: version,
    is_current_version: true,
    status: "submitted",
    submitted_date: at,
    rejection_reason: null,
    status_history: [{
      status: "submitted", changed_by: user.email, changed_at: at,
      reason: `New version (v${version}) created from v${quote.version_number || 1}`
    }]
  });
  if (!newQuote?.id || newQuote.id === quote.id) throw new Error("A distinct replacement quote was not created. The original remains current.");
  try {
    await updateQuote(quote.id, {is_current_version: false}, quote._rev);
  } catch (error) {
    throw new Error(`VERSION_RETIREMENT: Version ${version} was saved as ${newQuote.id}, but the original could not be retired: ${error.message}. Both records remain available; review them before retrying.`);
  }
  return newQuote;
}
