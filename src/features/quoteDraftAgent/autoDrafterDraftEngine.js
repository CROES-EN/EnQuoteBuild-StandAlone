// autoDrafterDraftEngine.js
//
// Auto-Drafter's own entry point into the SAME Quote Draft Agent (Step 2) engine already
// used by QuoteDraftButton.jsx (see src/features/quoteDraftAgent/QuoteDraftButton.jsx) --
// reuses parseQuoteRequestOutput(), detectQuoteBlockingIssues(), and generateQuoteDraft()
// completely UNCHANGED. No new matching/pricing/dependency logic lives here.
//
// CRITICAL BOUNDARY: this file deliberately stops BEFORE the two steps QuoteDraftButton.jsx
// performs after generating a draft -- toFormUpdates() and onApply() -- which are the only
// things that turn a draft into real Quote form updates. Because this file never calls
// either of those, a draft generated through this entry point can NEVER become a saved
// Quote record. It is designed to be saved ONLY onto its originating Auto-Drafter case row
// (see autoDrafterCaseDrafts.js), never into Quotes storage.

import {hasQuoteRequestEvidence, parseQuoteRequestOutput} from "@/features/quoteDraftAgent/quoteRequestTextParser";
import {detectQuoteBlockingIssues, generateQuoteDraft} from "@/features/quoteDraftAgent/draftEngine";

/**
 * Attempts to generate a Quote Draft directly from a raw Auto-Drafter case comment (the
 * same free-text blob AutoDrafter.jsx already imports from Salesforce). Mirrors
 * QuoteDraftButton.jsx's handlePreview() logic exactly, one level removed from the UI.
 *
 * Returns one of:
 *   { status: "not_step1_output", draft: null, blockingIssues: [], parsedRequest: null }
 *     - the comment does not look like genuine Quote Request Agent (Step 1) output.
 *   { status: "parse_error", draft: null, blockingIssues: [], parsedRequest: null, error }
 *     - looked like Step 1 output, but a required field could not be parsed.
 *   { status: "blocked", draft: null, blockingIssues: [...], parsedRequest }
 *     - this request matches a known "may not need a standard quote" pattern (non-Enphase
 *       panel, or an Enphase Care-eligible microinverter RMA) -- same detection
 *       QuoteDraftButton.jsx already performs. Caller should surface these issues and let
 *       the user explicitly choose to draft anyway via autoDraftAnyway() below.
 *   { status: "ok", draft: {...}, blockingIssues: [], parsedRequest }
 *     - a draft was generated successfully.
 */
export function autoDraftFromCaseComment(rawCaseComment) {
  if (!hasQuoteRequestEvidence(rawCaseComment)) {
    return { status: "not_step1_output", draft: null, blockingIssues: [], parsedRequest: null };
  }

  let parsedRequest;
  try {
    parsedRequest = parseQuoteRequestOutput(rawCaseComment);
  } catch (err) {
    return {
      status: "parse_error",
      draft: null,
      blockingIssues: [],
      parsedRequest: null,
      error: err?.message || "Could not parse this case comment as Quote Request Agent output."
    };
  }

  const blockingIssues = detectQuoteBlockingIssues(parsedRequest);
  if (blockingIssues.length > 0) {
    return { status: "blocked", draft: null, blockingIssues, parsedRequest };
  }

  const draft = generateQuoteDraft(parsedRequest);
  return { status: "ok", draft, blockingIssues: [], parsedRequest };
}

/**
 * Explicit override for a request that detectQuoteBlockingIssues() flagged -- mirrors
 * QuoteDraftButton.jsx's handleDraftAnyway(). Only ever called after a user has seen the
 * blocking issues and chosen to proceed anyway; never called automatically.
 */
export function autoDraftAnyway(parsedRequest) {
  return generateQuoteDraft(parsedRequest);
}
