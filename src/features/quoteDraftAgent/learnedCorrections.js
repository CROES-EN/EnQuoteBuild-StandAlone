// learnedCorrections.js
//
// A small, hand-maintained dictionary of confirmed corrections for requested item
// names that draftEngine.js's normal word-matching logic could not confidently match
// on its own (or matched to the wrong category-average placeholder). Checked FIRST,
// before any phrase/score matching is attempted -- so once a phrase is added here, it
// is matched correctly every single time from then on, with no ambiguity.
//
// This is intentionally simple (a plain JS object, no database/AI involved) so it is
// easy to review, edit, and extend directly in this file as new correct matches are
// confirmed on real quotes. Keys are matched case-insensitively and with extra
// whitespace collapsed, so "PV Load Shedding Box", "pv load shedding box", and
// "PV   Load Shedding Box" all resolve to the same entry.
//
// To add a new correction: add one line below with the exact phrase a technician
// might type, mapped to the EXACT product name as it appears in productCatalog.js.
export const LEARNED_CORRECTIONS = {
  "pv load shedding box": "IQ Load Controller",
  "load shedding box": "IQ Load Controller",
  "load shedding contactor": "IQ Load Controller",
  "3/4 flex conduit": "3/4 in. x 25 ft. Ultratite Liquidtight Flexible Non-Metallic PVC Conduit",
  "3/4 straight flex connector": "3/4 in. Rain Tight Connectors",
  "#10 thhn wire": "#10 THHN Stranded Copper"
};

// Normalizes a phrase the same way every key above is normalized, so lookups are
// consistent regardless of casing/spacing in the actual requested text.
function normalizeForLookup(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Returns the corrected catalog item NAME (a string) if this exact requested phrase
// has a known correction, or null if there is no entry for it.
export function findLearnedCorrection(requestedName) {
  const key = normalizeForLookup(requestedName);
  return LEARNED_CORRECTIONS[key] || null;
}