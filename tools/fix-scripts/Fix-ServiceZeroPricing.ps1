# Fix-ServiceZeroPricing.ps1
#
# Run from your project root (e.g. C:\EnQuoteBuild):
#   powershell -ExecutionPolicy Bypass -File .\Fix-ServiceZeroPricing.ps1
#   powershell -ExecutionPolicy Bypass -File .\Fix-ServiceZeroPricing.ps1 -Target sandbox
#   powershell -ExecutionPolicy Bypass -File .\Fix-ServiceZeroPricing.ps1 -PatchOnly
#
# THE CHANGE:
#   Previously, any requested SERVICE line item with no confident catalog
#   match (e.g. "Critter Guard Installation", "IQ Load Controller
#   Installation", "IQ Battery Installation") fell back to a fabricated
#   "Miscellaneous Services (unmatched: '<name>')" line priced at the
#   average of ALL catalog Services prices (e.g. $265.00) -- effectively
#   double-billing, since installation/service labor for these items is
#   already captured by the FST's hourly on-site labor charge
#   (Number of FSTs Needed x Number of Labor Hours on Site).
#
#   Now, an unmatched SERVICE is shown as a REBRANDED $0.00 line using the
#   requested service's own descriptive name (e.g. "Critter Guard
#   Installation") instead of the generic "Miscellaneous Services
#   (unmatched: ...)" label and instead of a fabricated dollar amount. If a
#   service line has no name at all, it falls back to
#   "Installation Service: <Scope of Work>" (still $0.00).
#
#   Products/materials are UNCHANGED -- they still fall back to the
#   category-average placeholder price when unmatched, since a physical
#   part genuinely needs some price rather than $0.
#
# This script backs up the current file, replaces it with the corrected
# version, verifies the replacement landed, then builds + verifies +
# deploys using the same safe pattern used throughout this session.

param(
    [ValidateSet("production", "sandbox")]
    [string]$Target = "production",
    [switch]$PatchOnly
)

$ErrorActionPreference = "Stop"

$targets = @{
    production = @{ AppId = "6979390a3f44099ffca06859"; BaseUrl = "https://enquote.base44.app" }
    sandbox    = @{ AppId = "6a91e7bce36dd777fa88cf04"; BaseUrl = "https://en-quote-stand-alone-fa88cf04.base44.app" }
}
$appId   = $targets[$Target].AppId
$baseUrl = $targets[$Target].BaseUrl

$targetFile = ".\src\features\quoteDraftAgent\draftEngine.js"
if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find $targetFile" -ForegroundColor Red
    Write-Host "Make sure you're running this from the project root." -ForegroundColor Yellow
    exit 1
}

# --- Step 1: Backup ---
$backupPath = "$targetFile.bak-before-service-zero-pricing"
Copy-Item -Path $targetFile -Destination $backupPath -Force
Write-Host "Backed up existing draftEngine.js to $backupPath" -ForegroundColor Cyan

# --- Step 2: Write the corrected file ---
$content = @'
// draftEngine.js
//
// Replicates the Quote Draft Agent (Step 2) logic LOCALLY, in the browser,
// with no LLM/API calls of any kind. Takes the structured output of the
// Quote Request Agent (Step 1) and produces: a scope-of-work paragraph,
// matched product/service/material line items (with real unit prices and
// tax codes from the product catalog), FST labor hours, travel hours,
// miles traveled, and an assumptions/notes summary -- mirroring the rules
// in the Quote Draft Agent Prompt (Step 2).
//
// This does NOT compute a final dollar total or sales tax -- EnQuote's own
// form already has federal/state/local tax percent fields and computes
// subtotal/discount/tax itself from the items + labor + travel this engine
// produces. This engine's job stops at producing accurate, tax-coded line
// items and labor/travel figures.

import { PRODUCT_CATALOG } from "./productCatalog";

// --- Tax code reference (from the Quote Draft Agent prompt) --------------
const TAX_CODES = {
  SERVICES: "SS300220",
  MICROINVERTER: "TTR146714",
  SOLAR_ACCESSORY: "TTR146718",
  SOLAR_CABLES_CONNECTORS: "TTR146716",
  COMMUNICATION_ACCESSORY: "TTR146719",
  GENERAL_ELECTRICAL_EQUIPMENT: "TTR152589"
};

// Maps a catalog "category" (as found in the spreadsheet) to one of the
// Quote Draft Agent's official Materials section names.
const CATEGORY_TO_SECTION = {
  "Wiring & Cable Management": "Electrical Materials",
  "Breakers": "Electrical Materials",
  "Conduit & Raceway": "Electrical Materials",
  "Enclosure": "Electrical Materials",
  "Junction Box": "Electrical Materials",
  "Microinverters": "Electrical Materials",
  "Critter Guard": "Critter Guard Materials",
  "Mounting / Racking": "Electrical Materials",
  "Roof Mounting & Sealing": "Weatherproofing Materials",
  "Rental Equipment": "Electrical Materials",
  "Enphase Products": "Electrical Materials",
  "Services": null // handled separately -- not a materials section
};

// Default average price per category, used ONLY when no catalog match is
// confident enough -- mirrors the team's own documented fallback rule:
// "if the tech puts in a product that isn't found on the product list, the
// agent would select the miscellaneous product... with the average price."
// NOTE: this fallback is only used for PRODUCTS/MATERIALS. Unmatched
// SERVICES are handled separately -- see the isService branch inside
// matchLineItem() -- because installation/service labor is already
// captured by the FST's hourly on-site labor charge, not by a second
// dollar-priced line item.
function computeCategoryAverages(catalog) {
  const sums = {};
  const counts = {};
  for (const item of catalog) {
    sums[item.category] = (sums[item.category] || 0) + item.unit_price;
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  const averages = {};
  for (const category of Object.keys(sums)) {
    averages[category] = Math.round((sums[category] / counts[category]) * 100) / 100;
  }
  return averages;
}

const CATEGORY_AVERAGES = computeCategoryAverages(PRODUCT_CATALOG);

// --- Unit handling / quantity conversion -----------------------------------
//
// Requests describe quantity in whatever unit the FST used (e.g. "297 ft"
// of critter guard wire), but the catalog sells many of those items in
// discrete packs/rolls (e.g. one roll covers 98 ft). Without converting,
// a request for "297 ft" would be priced as 297 * (price per roll) --
// wildly wrong. This section extracts the coverage-per-unit encoded in a
// catalog item's own name (e.g. "...98 ft. Critter Guard Roll Kit...") and
// uses it to compute how many discrete units are actually needed.

const LENGTH_UNIT_ALIASES = {
  ft: "ft", foot: "ft", feet: "ft", "linear ft": "ft", "linear feet": "ft", lf: "ft",
  in: "in", inch: "in", inches: "in"
};

// Catalog units that already represent a linear-length sale (price is
// itself "per foot") -- these should NEVER be converted, since the raw
// requested quantity already lines up with how the item is priced.
const LENGTH_SALE_UNITS = new Set(["ft", "foot", "feet", "linear ft", "lf"]);

function normalizeUnit(rawUnit) {
  const u = String(rawUnit || "").trim().toLowerCase();
  return LENGTH_UNIT_ALIASES[u] || u;
}

// Pulls the first "<number> ft" (or "feet"/"foot") pattern out of a catalog
// item's name, e.g. "...6 in. x 98 ft. Critter Guard Roll Kit..." -> 98.
// Deliberately targets ft/feet/foot specifically so a companion "6 in."
// dimension elsewhere in the same name is never mistaken for the coverage
// length.
function extractCoveragePerUnit(catalogItemName) {
  const match = String(catalogItemName || "").match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i);
  return match ? parseFloat(match[1]) : null;
}

// Given a matched catalog item and the raw requested quantity/unit, returns
// the correct { quantity, conversionNote } to bill -- converting a linear
// measurement into discrete catalog units (rolls/packs/each) whenever the
// catalog item's name reveals its coverage, and falling back to a safe
// default (quantity 1, flagged for manual review) when it cannot be
// determined, rather than ever multiplying a large linear quantity
// straight through against a per-unit price.
function resolveBilledQuantity(catalogItem, requestedQuantityRaw, requestedUnit) {
  const requestedQty = normalizeQuantity(requestedQuantityRaw);
  const reqUnit = normalizeUnit(requestedUnit);
  const catalogUnit = normalizeUnit(catalogItem.unit);

  // No conversion needed: units already match, or the catalog item is
  // itself sold by linear foot (price already reflects per-ft cost).
  if (!reqUnit || reqUnit === catalogUnit || LENGTH_SALE_UNITS.has(catalogUnit)) {
    return { quantity: requestedQty, conversionNote: null, needsReview: false };
  }

  if (reqUnit === "ft") {
    const coverage = extractCoveragePerUnit(catalogItem.name);
    if (coverage && coverage > 0) {
      const neededUnits = Math.ceil(requestedQty / coverage);
      return {
        quantity: neededUnits,
        conversionNote: `${catalogItem.name}: converted ${requestedQty} ft requested at ${coverage} ft/${catalogItem.unit} -> ${neededUnits} ${catalogItem.unit}(s).`,
        needsReview: false
      };
    }
    // Requested in feet, but this catalog item's coverage-per-unit could
    // not be determined -- do NOT multiply a large ft figure straight
    // through against a per-unit price. Default to 1 and flag for review.
    return {
      quantity: 1,
      conversionNote: `${catalogItem.name}: requested ${requestedQty} ft but this item's coverage per ${catalogItem.unit} is unknown -- quantity defaulted to 1, please verify.`,
      needsReview: true
    };
  }

  // Any other unit mismatch we don't have specific conversion logic for --
  // same safe default rather than guessing.
  return {
    quantity: requestedQty,
    conversionNote: null,
    needsReview: false
  };
}

// --- Text matching --------------------------------------------------------
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with",
  "each", "per", "pack", "set", "kit", "required", "replacement", "repair",
  "damaged", "damage", "verify", "operation", "operating", "system",
  "install", "installed", "remove", "existing", "new", "restore",
  "affected", "confirm", "normal"
]);

// Catalog categories that represent LABOR/SERVICE charges rather than
// physical parts. Products and materials must never match into this
// category (a physical cable should never resolve to a labor line), and
// services must ONLY match within this category -- never against an
// unrelated physical product just because a word like "wire" or "repair"
// happens to appear in both.
const SERVICE_CATEGORY = "Services";

// Words that, ALONE, are too generic to confidently select one specific
// catalog SKU out of many (e.g. dozens of catalog entries contain
// "connector" or "cable"). If a requested item's core tokens reduce to
// ONLY generic terms with no specific/technical qualifier (a model name,
// "Q", "MC4", "trunk", a brand, etc.), this engine will not guess a
// specific product -- it uses the category-average fallback instead and
// flags the item for manual verification, rather than risk pricing the
// wrong part.
const GENERIC_TERMS = new Set([
  "wire", "wires", "cable", "cables", "connector", "connectors",
  "clip", "clips", "bracket", "brackets", "material", "materials",
  "part", "parts", "component", "components", "accessory", "accessories",
  "hardware", "fastener", "fasteners"
]);

function normalizeForPhraseMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeForPhraseMatch(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function hasSpecificTerm(coreTokens) {
  return coreTokens.some((t) => !GENERIC_TERMS.has(t));
}

// Checks whether the requested item's name appears as a contiguous,
// WORD-BOUNDARY-aware phrase within a catalog item's name. This is
// deliberately stricter than a raw substring check: matching is done on
// tokenized word sequences, so "Q Cable" matching inside "IQ Cable" (a
// character-level coincidence -- "IQ" ends in "Q") is correctly rejected,
// while "Q Cable" matching inside "Enphase Q Cable Landscape" (a genuine
// whole-word match) is correctly accepted.
//
// Only queries with 2 or more meaningful words are eligible for phrase
// matching at all -- a single generic word (e.g. "Connectors") must never
// be treated as a strong phrase signal, since it will coincidentally
// appear inside many unrelated item names/descriptions.
function findPhraseMatch(requestedName, candidates) {
  const queryTokens = normalizeForPhraseMatch(requestedName).split(" ").filter(Boolean);
  if (queryTokens.length < 2) return null;

  for (const item of candidates) {
    const nameTokens = normalizeForPhraseMatch(item.name).split(" ").filter(Boolean);
    if (containsSubsequence(nameTokens, queryTokens)) {
      return item;
    }
  }
  return null;
}

// Returns true if `needle` appears as a contiguous run of whole tokens
// somewhere inside `haystack`.
function containsSubsequence(haystackTokens, needleTokens) {
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return false;
  for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
    let matchesHere = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        matchesHere = false;
        break;
      }
    }
    if (matchesHere) return true;
  }
  return false;
}

// Scores a catalog item against the CORE request tokens (the item's own
// name, e.g. "Q Cable" or "Connectors" -- NOT free-text notes, which are
// symptom/context descriptions and too noisy to use for matching). Notes
// are only used as a small tiebreaker signal, never as the primary basis
// for a match, and can never push an unmatched item over the confidence
// threshold on their own.
//
// In addition to raw hit count, this also computes `precision` -- what
// fraction of the CATALOG ITEM's own name was actually requested. This is
// what lets the engine correctly prefer a short, tightly-matching item
// (e.g. "Critter Guard Fastener Clips") over a long item name that only
// coincidentally shares a couple of the same words buried among many
// unrelated descriptive terms (e.g. a full "Solar Panel Bird Wire ...
// Critter Guard Roll Kit ... with Fasteners" product name). Without this,
// two catalog items can tie on raw score/coverage alone while one is
// clearly the better, more specific match.
function scoreMatch(coreTokens, noteTokens, catalogItem) {
  const nameTokens = tokenize(catalogItem.name);
  const descTokens = tokenize(catalogItem.description || "");

  let coreHits = 0;
  let coreScore = 0;
  for (const token of coreTokens) {
    if (nameTokens.includes(token)) {
      coreHits += 1;
      coreScore += 3;
    } else if (descTokens.includes(token)) {
      coreHits += 1;
      coreScore += 1;
    }
  }

  let noteScore = 0;
  for (const token of noteTokens) {
    if (nameTokens.includes(token)) noteScore += 0.5;
  }

  const coverage = coreTokens.length > 0 ? coreHits / coreTokens.length : 0;
  const precision = nameTokens.length > 0 ? coreHits / nameTokens.length : 0;

  // Small additive bonus (not enough to override a genuinely stronger
  // match elsewhere) that breaks ties in favor of the tighter, more
  // specific catalog name.
  const score = coreScore + noteScore + precision * 2;

  return { score, coverage, coreHits, precision };
}

// Optional category hint narrows the search (e.g. "critter guard" requests
// should prefer the Critter Guard category) without excluding other
// categories entirely, in case the right item lives elsewhere. `isService`
// hard-filters candidates to (or away from) the Services category -- this
// is a hard rule, not a soft preference, because a labor/service request
// must never resolve to a physical product and vice versa.
function findBestCatalogMatch(requestedName, notesText, categoryHint, isService) {
  const coreTokens = tokenize(requestedName);
  const noteTokens = tokenize(notesText);
  if (coreTokens.length === 0) return { match: null, score: 0, coverage: 0 };

  const candidates = PRODUCT_CATALOG.filter((item) =>
    isService ? item.category === SERVICE_CATEGORY : item.category !== SERVICE_CATEGORY
  );

  let best = null;
  let bestScore = 0;
  let bestCoverage = 0;
  for (const item of candidates) {
    const { score, coverage } = scoreMatch(coreTokens, noteTokens, item);
    let adjustedScore = score;
    if (categoryHint && item.category === categoryHint) adjustedScore += 1.5;
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestCoverage = coverage;
      best = item;
    }
  }
  return { match: best, score: bestScore, coverage: bestCoverage };
}

// A match is only trusted when BOTH a minimum raw score is met AND a
// minimum proportion of the requested item's own core words are found in
// the catalog item's name. The coverage requirement is what prevents a
// single shared incidental word (e.g. "wire") from producing a confident
// but wrong match -- every meaningful word in a short request like
// "Q Cable" or "Connectors" must actually be present.
const MATCH_SCORE_THRESHOLD = 3;
const MATCH_COVERAGE_THRESHOLD = 0.5;

// Guesses the most likely category for an unmatched item based on keywords
// in its name, so the miscellaneous fallback price/tax-code is at least
// in the right ballpark category.
const CATEGORY_KEYWORDS = [
  { category: "Critter Guard", keywords: ["critter", "rodent", "animal", "chew", "pest"] },
  { category: "Wiring & Cable Management", keywords: ["wire", "cable", "connector", "splice", "conductor", "awg"] },
  { category: "Microinverters", keywords: ["microinverter", "micro inverter", "iq7", "iq8"] },
  { category: "Roof Mounting & Sealing", keywords: ["roof", "flashing", "sealant", "seal", "clamp", "mount"] },
  { category: "Breakers", keywords: ["breaker", "fuse"] },
  { category: "Junction Box", keywords: ["junction", "box", "enclosure", "disconnect"] },
  { category: "Conduit & Raceway", keywords: ["conduit", "raceway", "emt", "pvc"] },
  { category: "Rental Equipment", keywords: ["rental", "ladder", "lift", "truck"] }
];

function guessCategoryFromText(text) {
  const lower = String(text || "").toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.category;
  }
  return "Wiring & Cable Management"; // safest general default for solar repair parts
}

// Matches a single requested line (product, service, or additional
// material) against the catalog, returning a fully-priced, tax-coded line
// item ready for EnQuote's `items` array. Falls back to a labeled
// "Miscellaneous <category>" placeholder with the category's average price
// when no confident match exists for a PRODUCT/MATERIAL -- never
// fabricates a specific product or price outside catalog data.
//
// For SERVICES specifically, an unmatched request is NOT priced with a
// fabricated placeholder dollar amount at all. Installation/service labor
// for something like "Critter Guard Installation" or "IQ Battery
// Installation" is already captured by the FST's hourly on-site labor
// charge (Number of FSTs Needed x Number of Labor Hours on Site), so
// adding a second dollar amount for the same labor would double-bill it.
// Instead, the requested service's own name is shown as a $0.00 line item
// (rebranded, not "Miscellaneous Services (unmatched: ...)"), so the
// scope of work is still visible on the quote without an inflated total.
function matchLineItem(requestedName, requestedQuantity, requestedUnit, notes, categoryHint, isService) {
  const coreTokens = tokenize(requestedName);
  const candidates = PRODUCT_CATALOG.filter((item) =>
    isService ? item.category === SERVICE_CATEGORY : item.category !== SERVICE_CATEGORY
  );

  // A request must contain at least one specific/technical word (not just
  // generic terms like "cable", "connector", "wire" alone) before this
  // engine will attempt ANY specific-SKU match -- phrase match included.
  // This is checked first so a coincidental word overlap in an unrelated
  // item's name can never bypass the safeguard.
  const canAttemptSpecificMatch = hasSpecificTerm(coreTokens);

  // Strongest signal: the requested name appears nearly verbatim, as whole
  // words, inside a catalog item's name (e.g. "Q Cable" inside
  // "Enphase Q Cable Landscape").
  const phraseMatch = canAttemptSpecificMatch ? findPhraseMatch(requestedName, candidates) : null;
  if (phraseMatch) {
    const { quantity, conversionNote, needsReview } = resolveBilledQuantity(
      phraseMatch, requestedQuantity, requestedUnit
    );
    return {
      requested_name: requestedName,
      name: phraseMatch.name,
      quantity,
      unit_price: phraseMatch.unit_price,
      unit: phraseMatch.unit,
      total: Math.round(phraseMatch.unit_price * quantity * 100) / 100,
      taxable: true,
      tax_code: phraseMatch.tax_code,
      section: CATEGORY_TO_SECTION[phraseMatch.category] || "Electrical Materials",
      matched: true,
      match_confidence: "phrase",
      conversion_note: conversionNote,
      needs_review: needsReview
    };
  }

  // (canAttemptSpecificMatch already computed above, before the phrase
  // match attempt, so both matching strategies share the same safeguard.)
  const { match, score, coverage } = canAttemptSpecificMatch
    ? findBestCatalogMatch(requestedName, notes, categoryHint, isService)
    : { match: null, score: 0, coverage: 0 };

  const confidentMatch = match && score >= MATCH_SCORE_THRESHOLD && coverage >= MATCH_COVERAGE_THRESHOLD;

  if (confidentMatch) {
    const { quantity, conversionNote, needsReview } = resolveBilledQuantity(
      match, requestedQuantity, requestedUnit
    );
    return {
      requested_name: requestedName,
      name: match.name,
      quantity,
      unit_price: match.unit_price,
      unit: match.unit,
      total: Math.round(match.unit_price * quantity * 100) / 100,
      taxable: true,
      tax_code: match.tax_code,
      section: CATEGORY_TO_SECTION[match.category] || "Electrical Materials",
      matched: true,
      match_confidence: score,
      conversion_note: conversionNote,
      needs_review: needsReview
    };
  }

  // --- No confident catalog match ---

  if (isService) {
    // Installation/service line items with no catalog match are treated
    // as labor already included in the FST's on-site hours -- shown as a
    // rebranded $0.00 line using the requested service's own name (e.g.
    // "Critter Guard Installation", "IQ Load Controller Installation",
    // "IQ Battery Installation") rather than a fabricated
    // "Miscellaneous Services" placeholder charge.
    const displayName = requestedName && requestedName.trim().length > 0
      ? requestedName.trim()
      : "Installation Service";
    return {
      requested_name: requestedName,
      name: displayName,
      quantity: 1,
      unit_price: 0,
      unit: "each",
      total: 0,
      taxable: false,
      tax_code: TAX_CODES.SERVICES,
      section: null,
      matched: false,
      match_confidence: score,
      conversion_note: null,
      needs_review: false,
      zero_priced_service: true
    };
  }

  // Products/materials still need a real placeholder price -- use the
  // category-average fallback as before.
  // IMPORTANT: if the request expressed quantity in a linear unit (e.g.
  // "ft") we have no per-foot rate to fall back to -- multiplying a large
  // linear quantity by a flat "per each" average price would produce a
  // wildly inflated total, so quantity is capped to 1 and the item is
  // flagged for manual review instead.
  const searchText = `${requestedName} ${notes || ""}`;
  const guessedCategory = guessCategoryFromText(searchText) || categoryHint || "Wiring & Cable Management";
  const averagePrice = CATEGORY_AVERAGES[guessedCategory] || 25;
  const fallbackTaxCategory = PRODUCT_CATALOG.find((i) => i.category === guessedCategory)?.tax_category
    || "GENERAL_ELECTRICAL_EQUIPMENT";
  const fallbackTaxCode = TAX_CODES[fallbackTaxCategory] || TAX_CODES.GENERAL_ELECTRICAL_EQUIPMENT;

  const reqUnitNorm = normalizeUnit(requestedUnit);
  const rawQty = normalizeQuantity(requestedQuantity);
  const isLinearUnit = reqUnitNorm === "ft" || reqUnitNorm === "in";
  const fallbackQuantity = isLinearUnit ? 1 : rawQty;
  const fallbackNote = isLinearUnit
    ? `Requested ${rawQty} ${requestedUnit || ""} but no catalog match or per-unit rate exists for "${requestedName}" -- quantity defaulted to 1 at the category average price, please verify and correct manually.`
    : null;

  return {
    requested_name: requestedName,
    name: `Miscellaneous ${guessedCategory} (unmatched: "${requestedName}")`,
    quantity: fallbackQuantity,
    unit_price: averagePrice,
    unit: "each",
    total: Math.round(averagePrice * fallbackQuantity * 100) / 100,
    taxable: true,
    tax_code: fallbackTaxCode,
    section: CATEGORY_TO_SECTION[guessedCategory] || "Electrical Materials",
    matched: false,
    match_confidence: score,
    conversion_note: fallbackNote,
    needs_review: isLinearUnit
  };
}

function normalizeQuantity(rawQuantity) {
  if (rawQuantity === null || rawQuantity === undefined) return 1;
  const str = String(rawQuantity).trim();
  if (!str || /^unknown$/i.test(str)) return 1;
  const num = parseFloat(str.replace(/[^\d.]/g, ""));
  return isNaN(num) || num <= 0 ? 1 : num;
}

// --- Labor & travel (same rules as the Step 2 prompt) ---------------------
const DEFAULT_LABOR_RATE = 125;
const TRAVEL_HOUR_RATE = 65;
const MILEAGE_RATE = 0.73;

function resolveWorstCase(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str || /^unknown$/i.test(str)) return null;
  const rangeMatch = str.match(/([\d.]+)\s*(?:-|to)\s*([\d.]+)/i);
  if (rangeMatch) {
    return Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
  }
  const singleMatch = str.match(/[\d.]+/);
  return singleMatch ? parseFloat(singleMatch[0]) : null;
}

// --- Scope of work generation (template-based, no LLM) ---------------------
function generateScopeOfWork(request) {
  const parts = [];

  if (request.scopeDescription) {
    parts.push(request.scopeDescription.trim());
  } else if (request.problemDescription || request.rootCause) {
    const problem = request.problemDescription ? request.problemDescription.trim() : "";
    const cause = request.rootCause ? request.rootCause.trim() : "";
    if (problem) parts.push(problem);
    if (cause && cause.toLowerCase() !== problem.toLowerCase()) {
      parts.push(`Root cause identified as: ${cause}`);
    }
  }

  if (request.diagnosticFindings) {
    parts.push(request.diagnosticFindings.trim());
  }

  if (parts.length === 0) {
    return "Scope of work requires manual entry -- insufficient detail was provided in the quote request to generate a summary.";
  }

  return parts.join(" ");
}

// --- Assumption / notes generation ----------------------------------------
function generateAssumptions(request, { fstCount, laborHours, usedWorstCase, unmatchedItems, conversionNotes, zeroPricedServiceNames }) {
  const notes = [];

  if (usedWorstCase) {
    notes.push("Worst-case labor estimate used per request guidance (a range was provided).");
  }
  notes.push(`${fstCount} technician${fstCount === 1 ? "" : "s"} assigned.`);
  notes.push(`Estimated onsite labor hours: ${laborHours} hour${laborHours === 1 ? "" : "s"}.`);
  notes.push(`Labor rate assumed at $${DEFAULT_LABOR_RATE.toFixed(2)}/hour (organization default -- no rate was specified in the request).`);
  notes.push(`Travel billed at $${TRAVEL_HOUR_RATE.toFixed(2)}/hour and $${MILEAGE_RATE.toFixed(2)}/mile per standard rates.`);

  if (zeroPricedServiceNames.length > 0) {
    notes.push(
      `The following installation/service item(s) are included at no additional charge, covered by the FST's on-site labor hours above: ${zeroPricedServiceNames.join(", ")}.`
    );
  }

  if (conversionNotes.length > 0) {
    notes.push(`Quantity conversions applied: ${conversionNotes.join(" ")}`);
  }

  if (unmatchedItems.length > 0) {
    notes.push(
      `The following requested items had no confident catalog match and were priced using the category average as a placeholder -- please verify before finalizing: ${unmatchedItems.join(", ")}.`
    );
  }

  return notes.join(" ");
}

function generateRiskStatement(request, { hasUnknowns, unmatchedItems }) {
  if (!hasUnknowns && unmatchedItems.length === 0) return "";
  return "This quote assumes replacement of the identified damaged components and materials described above. If additional hidden damage is discovered after module removal, branch circuit exposure, or system inspection, additional labor and/or materials may be required and would be communicated through a change order requiring customer approval.";
}

// Merges line items that resolved to the identical catalog product (e.g.
// the same physical SKU requested once under "Products" and again under
// "Additional Materials") into a single consolidated line, summing
// quantity and recomputing the total -- rather than showing the same
// product twice as separate rows.
function deduplicateItems(items) {
  const merged = new Map();
  const order = [];

  for (const item of items) {
    const key = item.name.toLowerCase();
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.quantity += item.quantity;
      existing.total = Math.round(existing.unit_price * existing.quantity * 100) / 100;
      if (item.conversion_note && !existing.conversion_note) {
        existing.conversion_note = item.conversion_note;
      }
      existing.needs_review = existing.needs_review || item.needs_review;
    } else {
      merged.set(key, { ...item });
      order.push(key);
    }
  }

  return order.map((key) => merged.get(key));
}

// --- Main entry point -------------------------------------------------------
// `request` shape (produced by parsing Step 1 output -- see
// quoteRequestTextParser.js):
// {
//   siteId, caseNumber, customer, siteAddress, quoteCategory,
//   problemDescription, rootCause, diagnosticFindings, scopeDescription,
//   technicianCount, onsiteLaborHours, totalLaborHours,
//   driveHours, driveMiles,
//   products: [{ name, quantity, unit, notes }],
//   services: [{ name, quantity, unit, notes }],
//   materials: [{ name, quantity, unit, notes }],
//   hasUnknownFields: boolean
// }
export function generateQuoteDraft(request) {
  const fstCount = Math.round(resolveWorstCase(request.technicianCount) || 1);
  const laborHours = resolveWorstCase(request.onsiteLaborHours)
    ?? resolveWorstCase(request.totalLaborHours)
    ?? 0;
  const usedWorstCase = /(-|to)/i.test(String(request.onsiteLaborHours || request.totalLaborHours || ""));

  const travelHours = resolveWorstCase(request.driveHours) || 0;
  const milesTraveled = resolveWorstCase(request.driveMiles) || 0;

  let items = [];
  const unmatchedItems = [];
  const conversionNotes = [];
  const zeroPricedServiceNames = [];

  const allRequestedLines = [
    ...(request.products || []).map((p) => ({ ...p, kind: "product" })),
    ...(request.materials || []).map((m) => ({ ...m, kind: "material" })),
    ...(request.services || [])
      .map((s) => ({ ...s, kind: "service", name: s.name }))
  ];

  for (const line of allRequestedLines) {
    // Services without an explicit name fall back to a scope-of-work-based
    // label instead of being skipped -- installation labor tied to the
    // overall job should still show as a $0 line rather than silently
    // disappearing.
    if (!line.name) {
      if (line.kind === "service") {
        line.name = request.scopeDescription
          ? `Installation Service: ${request.scopeDescription}`
          : "Installation Service";
      } else {
        continue;
      }
    }

    const isService = line.kind === "service";
    const categoryHint = isService ? "Services" : guessCategoryFromText(`${line.name} ${line.notes || ""}`);
    const lineItem = matchLineItem(line.name, line.quantity, line.unit, line.notes, categoryHint, isService);

    // Services priced at $0 in the catalog (a CONFIDENT match to a real
    // catalog service that happens to be $0) represent labor already
    // covered by the FST's hourly on-site labor charge -- skip adding a
    // duplicate $0 line for those specifically, to avoid clutter. This is
    // distinct from the zero_priced_service fallback below, which we DO
    // want to show (it carries the requested service's own descriptive
    // name, e.g. "Critter Guard Installation", not a generic catalog name).
    if (line.kind === "service" && lineItem.matched && lineItem.unit_price === 0) {
      continue;
    }

    items.push(lineItem);
    if (lineItem.zero_priced_service) {
      zeroPricedServiceNames.push(lineItem.name);
    } else if (!lineItem.matched) {
      unmatchedItems.push(line.name);
    }
    if (lineItem.conversion_note) conversionNotes.push(lineItem.conversion_note);
  }

  items = deduplicateItems(items);

  const scopeOfWork = generateScopeOfWork(request);
  const notes = generateAssumptions(request, {
    fstCount, laborHours, usedWorstCase, unmatchedItems, conversionNotes, zeroPricedServiceNames
  });
  const riskStatement = generateRiskStatement(request, {
    hasUnknowns: Boolean(request.hasUnknownFields),
    unmatchedItems
  });

  return {
    site_id: request.siteId || "",
    case_number: request.caseNumber || "",
    customer: request.customer || "",
    site_address: request.siteAddress || "",
    scope_of_work: scopeOfWork,
    fst_count: fstCount,
    labor_hours: laborHours,
    labor_rate: DEFAULT_LABOR_RATE,
    travel_hours: travelHours,
    travel_rate: TRAVEL_HOUR_RATE,
    miles_traveled: milesTraveled,
    mileage_rate: MILEAGE_RATE,
    items: items.map((item) => ({
      product_id: null,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      total: item.total,
      taxable: item.taxable,
      tax_code: item.tax_code
    })),
    notes: [notes, riskStatement].filter(Boolean).join("\n\n"),
    unmatched_count: unmatchedItems.length,
    unmatched_items: unmatchedItems
  };
}

export { findBestCatalogMatch, matchLineItem, CATEGORY_AVERAGES, TAX_CODES };

'@

Set-Content -Path $targetFile -Value $content -Encoding UTF8 -NoNewline
Write-Host "draftEngine.js has been replaced with the service-zero-pricing version." -ForegroundColor Green

# --- Step 3: Sanity check ---
$hasZeroPriceFlag = Select-String -Path $targetFile -Pattern "zero_priced_service" -Quiet
$hasInstallFallback = Select-String -Path $targetFile -Pattern "Installation Service" -Quiet
$hasCoverageFn = Select-String -Path $targetFile -Pattern "extractCoveragePerUnit" -Quiet

if (-not ($hasZeroPriceFlag -and $hasInstallFallback -and $hasCoverageFn)) {
    Write-Host "WARNING: One or more expected pieces were not found in the written file. Please review manually." -ForegroundColor Red
    Write-Host "  zero_priced_service flag present: $hasZeroPriceFlag" -ForegroundColor Yellow
    Write-Host "  Installation Service fallback present: $hasInstallFallback" -ForegroundColor Yellow
    Write-Host "  extractCoveragePerUnit (critter guard fix) present: $hasCoverageFn" -ForegroundColor Yellow
    exit 1
}
Write-Host "Sanity check passed: service zero-pricing change + prior critter guard fix both present." -ForegroundColor Green

if ($PatchOnly) {
    Write-Host ""
    Write-Host "PatchOnly mode: skipping build/deploy. File is patched; test locally when ready." -ForegroundColor Yellow
    exit 0
}

# --- Step 4: Check for the rogue shell-level env var ---
$shellOverride = [Environment]::GetEnvironmentVariable("VITE_DATA_SOURCE", "Process")
if ($shellOverride) {
    Write-Host "WARNING: A shell-level VITE_DATA_SOURCE='$shellOverride' is set in this terminal session. Clearing it." -ForegroundColor Yellow
    Remove-Item Env:VITE_DATA_SOURCE -ErrorAction SilentlyContinue
}

# --- Step 5: Build + deploy using the same safe, verified pattern ---
$envPath = ".\.env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found." -ForegroundColor Red
    exit 1
}

$envBackupPath = ".\.env.local.before-service-zero-pricing.bak"
Copy-Item -Path $envPath -Destination $envBackupPath -Force

$envContent = @"
VITE_DATA_SOURCE=base44
VITE_BASE44_FUNCTIONS_VERSION=prod
VITE_BASE44_APP_BASE_URL=$baseUrl
VITE_BASE44_SERVER_URL=https://base44.app
VITE_BASE44_APP_ID=$appId
"@
Set-Content -Path $envPath -Value $envContent -Encoding UTF8

Write-Host ""
Write-Host "=== Building for target: $Target ($appId) ===" -ForegroundColor Cyan
Remove-Item -Recurse -Force ".\node_modules\.vite" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\dist" -ErrorAction SilentlyContinue

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    npm run build
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    if (-not (Test-Path "$NodePath\npm.cmd")) {
        Write-Host "ERROR: npm not found on PATH and not found at $NodePath\npm.cmd" -ForegroundColor Red
        Copy-Item -Path $envBackupPath -Destination $envPath -Force
        exit 1
    }
    & "$NodePath\npm.cmd" run build
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed (likely a syntax error). Restoring .env.local." -ForegroundColor Red
    Write-Host "The original draftEngine.js is still backed up at $backupPath if you need to roll back." -ForegroundColor Yellow
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 1
}

$dataSourceOk = $false
$appIdOk = $false
$builtFiles = Get-ChildItem .\dist\assets\*.js -ErrorAction SilentlyContinue
foreach ($f in $builtFiles) {
    $c = Get-Content $f.FullName -Raw
    if ($c -match '\["mock","local","salesforce-mock"\]\.includes\(([^)]*)\)') {
        Write-Host "  Data source check ($($f.Name)): $($Matches[0])"
        if ($Matches[0] -match '"base44"') { $dataSourceOk = $true }
    }
    if ($c -match [regex]::Escape($appId)) { $appIdOk = $true }
}

if (-not $dataSourceOk -or -not $appIdOk) {
    Write-Host ""
    Write-Host "ABORTING: Build verification failed (data source or app id not correctly baked in)." -ForegroundColor Red
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Build verified clean: base44 data source + $Target app id confirmed." -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploying to $Target ($appId) with --no-build ===" -ForegroundColor Cyan
base44 deploy --app-id $appId --no-build --yes

Write-Host ""
Write-Host "Restoring your original .env.local..." -ForegroundColor Cyan
Copy-Item -Path $envBackupPath -Destination $envPath -Force

Write-Host ""
Write-Host "Done. Re-test the critter guard request on $baseUrl" -ForegroundColor Green
Write-Host "Expect: the 'Critter Guard Installation' line now shows at `$0.00 (not `$265.00)," -ForegroundColor Green
Write-Host "and the subtotal should be ~`$207 (4 rolls `$167 + fastener clips `$40), not `$472." -ForegroundColor Green
