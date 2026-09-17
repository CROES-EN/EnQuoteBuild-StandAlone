/**
 * Cross-references Workload rows against EnQuote's own quotes, per explicit request: "mark
 * Site ID's &/or cases if they have [a quote]." Matches on EITHER quote.site_id === row's
 * "Enlighten Site ID" OR quote.case_number === row's "Case Number" (case-insensitive/trimmed) -
 * a match on either field counts, since a homeowner's site could be found via either identifier
 * depending on how the original quote was created.
 *
 * VERSION-COLLAPSING (fixed after real-world testing surfaced a "+8" for what was really one
 * quote with many resubmission versions): confirmed directly from this app's own
 * QuoteVersionHistory.jsx that quote VERSIONS are linked via `parent_quote_id` (a root quote's
 * own `id` is its version-chain's anchor; every resubmission shares that same
 * parent_quote_id) - NOT via site_id, which was this file's original (incorrect) assumption.
 * Multiple quotes can legitimately share one site_id/case_number for two very different
 * reasons: (a) they're really the SAME quote, just different versions of its resubmission
 * history - these should count as ONE match, or (b) they're genuinely SEPARATE, independent
 * quotes that happen to reference the same site/case - these should count as separate matches.
 * findMatchingQuotes() below now collapses (a) down to one representative entry (the current
 * version, i.e. is_current_version !== false, falling back to the highest version_number if
 * that flag is ever missing) before counting/returning - so the badge and its underlying list
 * now reflect genuinely distinct quotes, not resubmission noise.
 */

/** Builds a fast lookup index from the full quotes list - call once per quotes load, not per row. */
export function buildQuoteMatchIndex(quotes) {
  const bySiteId = new Map();
  const byCaseNumber = new Map();
  (quotes || []).forEach((q) => {
    const siteId = String(q.site_id ?? "").trim().toLowerCase();
    const caseNumber = String(q.case_number ?? "").trim().toLowerCase();
    if (siteId) {
      if (!bySiteId.has(siteId)) bySiteId.set(siteId, []);
      bySiteId.get(siteId).push(q);
    }
    if (caseNumber) {
      if (!byCaseNumber.has(caseNumber)) byCaseNumber.set(caseNumber, []);
      byCaseNumber.get(caseNumber).push(q);
    }
  });
  return { bySiteId, byCaseNumber };
}

/** The stable identifier for a quote's entire version-chain - its own id if it's the root
 *  (no parent_quote_id), or its parent_quote_id if it's a resubmitted version. Two quotes with
 *  the same chain ID are versions of the SAME underlying quote, not separate quotes. */
function versionChainId(quote) {
  return quote?.parent_quote_id || quote?.id;
}

/** Picks the single best representative version to show for a version-chain: the one flagged
 *  is_current_version (not === false), or - if that flag is ever missing/ambiguous across the
 *  whole chain - whichever has the highest version_number, as a reasonable fallback. */
function pickRepresentativeVersion(versionsInChain) {
  const current = versionsInChain.find((q) => q.is_current_version !== false);
  if (current) return current;
  return [...versionsInChain].sort((a, b) => (b.version_number || 1) - (a.version_number || 1))[0];
}

/**
 * Returns one entry per DISTINCT matching quote (by Site ID or Case Number), with every
 * resubmission version of the same underlying quote collapsed down to its single current/
 * representative version - so a quote with 8 resubmission versions correctly counts as 1
 * match, not 8. Sorted most-recently-updated first.
 */
export function findMatchingQuotes(index, row) {
  const siteId = String(row?.["Enlighten Site ID"] ?? "").trim().toLowerCase();
  const caseNumber = String(row?.["Case Number"] ?? "").trim().toLowerCase();
  if (!siteId && !caseNumber) return [];

  const rawMatches = new Map();
  if (siteId && index.bySiteId.has(siteId)) {
    index.bySiteId.get(siteId).forEach((q) => rawMatches.set(q.id, q));
  }
  if (caseNumber && index.byCaseNumber.has(caseNumber)) {
    index.byCaseNumber.get(caseNumber).forEach((q) => rawMatches.set(q.id, q));
  }

  // Group raw matches by version-chain, then collapse each chain down to ONE representative.
  const chains = new Map();
  rawMatches.forEach((q) => {
    const chainId = versionChainId(q);
    if (!chains.has(chainId)) chains.set(chainId, []);
    chains.get(chainId).push(q);
  });
  const collapsed = Array.from(chains.values()).map(pickRepresentativeVersion);

  return collapsed.sort((a, b) => {
    const aDate = new Date(a.updated_date || a.updated_at || a.created_date || 0).getTime();
    const bDate = new Date(b.updated_date || b.updated_at || b.created_date || 0).getTime();
    return bDate - aDate;
  });
}
