import {parseQuoteRequestCase} from "./parseQuoteRequestCase.js";
import {reviewCaseKey} from "./caseKey.js";
import {alternateRequestType} from "../quoteRequestIntake/quoteRequestComment.js";

export function prepareAutomaticDraft(candidate) {
  const alternate = alternateRequestType(candidate.comment);
  if (alternate) return {skip: `${alternate.label} request (${alternate.heading}), not a quote request. See Alternate Requests.`};
  const {request, parseWarnings} = parseQuoteRequestCase(candidate.comment);
  if (!String(candidate.caseNumber || "").trim()) return {skip: "Missing case number."};
  if (request.multipleQuoteOptions) return {skip: "Multiple quote options requested. Split the alternatives before generating a priced draft."};
  if (!request.scopeDescription && !request.products.length && !request.materials.length && !request.services.length && !request.warrantyReplacements.length) {
    return {skip: "No structured scope or line items to draft. Complete the request summary."};
  }
  if (request.caseNumber && reviewCaseKey(request.caseNumber) !== reviewCaseKey(candidate.caseNumber)) {
    parseWarnings.push("Comment Case Number differs from the report. The report case number was retained; verify before sending.");
  }
  if (candidate.siteId && request.siteId && String(candidate.siteId).trim() !== String(request.siteId).trim()) {
    parseWarnings.push("Comment Site ID differs from the report. The report site ID was retained; verify before sending.");
  }
  return {request: {...request, caseNumber: candidate.caseNumber, siteId: candidate.siteId || request.siteId}, parseWarnings};
}

export async function runAutomaticDraftBatch(candidates, {listSaved, buildDraft, createIfMissing, onSaved, onProgress, isCancelled}) {
  const saved = new Set((await listSaved()).map(record => reviewCaseKey(record.caseNumber ?? record.id)));
  const result = {created: 0, skipped: [], errors: []};
  for (const candidate of candidates) {
    if (isCancelled()) break;
    if (saved.has(reviewCaseKey(candidate.caseNumber))) continue;
    const prepared = prepareAutomaticDraft(candidate);
    if (prepared.skip) {
      result.skipped.push({caseNumber: candidate.caseNumber, reason: prepared.skip});
      continue;
    }
    try {
      const draft = buildDraft(prepared.request);
      const savedResult = await createIfMissing(candidate.caseNumber, {
        siteId: candidate.siteId || draft.site_id || "",
        quoteNumber: `AI-${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`,
        status: "ai_generated_quote_needs_review", draft, sourceComment: candidate.comment,
        parseWarnings: prepared.parseWarnings, generatedAt: new Date().toISOString()
      });
      saved.add(reviewCaseKey(candidate.caseNumber));
      if (savedResult.created) result.created += 1;
      onSaved(savedResult.record);
    } catch (error) {
      console.error(`Automatic draft failed for case ${candidate.caseNumber}:`, error);
      result.errors.push({caseNumber: candidate.caseNumber, reason: error.message});
    }
    onProgress(result);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return result;
}
