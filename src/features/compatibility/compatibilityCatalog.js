// compatibilityCatalog.js
//
// Product IDENTITY records (SKU, manufacturer, category, generation, region) used ONLY by
// the Compatibility Matrix / dependency-validation system (see compatibilityMatrix.js,
// productDependencyMatrix.js, compatibilityEngine.js).
//
// DELIBERATELY SEPARATE from src/features/quoteDraftAgent/productCatalog.js (the "Legacy
// Catalog" -- see that file's own header comment). This is NOT a reconciliation or merge
// of the two catalogs. There is no shared key between them and none is being created here.
// The Legacy Catalog continues to drive matching/pricing in draftEngine.js completely
// unchanged; this catalog exists ONLY to give the Compatibility Matrix stable SKUs to
// validate against.
//
// Source: EnQuote_Enphase_Installation_Catalog.xlsx, "Products" sheet. Every record below
// was transcribed directly from that sheet -- no SKU, name, or field here was invented.
// Only NON-generic (non "GEN-*") products are included: the Compatibility_Matrix and
// Product_Dependencies sheets only ever reference real Enphase-family equipment SKUs, never
// the generic BOS placeholders (wire, conduit, fittings, etc.) -- so those are out of scope
// for this catalog specifically. (They remain fully in scope for Sourcing/BOS work later.)
//
// Fields kept intentionally minimal and workbook-faithful:
//   sku, manufacturer, productName, category, subcategory, generation, region,
//   voltageClass, confidence, verificationStatus
// No pricing fields exist here on purpose -- pricing stays exclusively in the Legacy
// Catalog. This catalog answers "what is this product and how sure are we of that record,"
// never "what does it cost."

export const COMPATIBILITY_CATALOG = [
  // --- Microinverters: M Series (legacy) ---
  { sku: "M175", manufacturer: "Enphase Energy", productName: "M175 Microinverter", category: "Microinverter", subcategory: "M Series", generation: "M Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "M190", manufacturer: "Enphase Energy", productName: "M190 Microinverter", category: "Microinverter", subcategory: "M Series", generation: "M Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "M210", manufacturer: "Enphase Energy", productName: "M210 Microinverter", category: "Microinverter", subcategory: "M Series", generation: "M Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "M215", manufacturer: "Enphase Energy", productName: "M215 Microinverter", category: "Microinverter", subcategory: "M Series", generation: "M Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "M250", manufacturer: "Enphase Energy", productName: "M250 Microinverter", category: "Microinverter", subcategory: "M Series", generation: "M Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Microinverters: S Series (legacy) ---
  { sku: "S230", manufacturer: "Enphase Energy", productName: "S230 Microinverter", category: "Microinverter", subcategory: "S Series", generation: "S Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "S280", manufacturer: "Enphase Energy", productName: "S280 Microinverter", category: "Microinverter", subcategory: "S Series", generation: "S Series", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Microinverters: IQ6 ---
  { sku: "IQ6", manufacturer: "Enphase Energy", productName: "IQ6 Microinverter", category: "Microinverter", subcategory: "IQ6", generation: "IQ6", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ6PLUS", manufacturer: "Enphase Energy", productName: "IQ6+ Microinverter", category: "Microinverter", subcategory: "IQ6", generation: "IQ6", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ6X", manufacturer: "Enphase Energy", productName: "IQ6X Microinverter", category: "Microinverter", subcategory: "IQ6", generation: "IQ6", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Microinverters: IQ7 ---
  { sku: "IQ7-60-2-US", manufacturer: "Enphase Energy", productName: "IQ7 Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ7PLUS-72-2-US", manufacturer: "Enphase Energy", productName: "IQ7+ Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ7A-72-2-US", manufacturer: "Enphase Energy", productName: "IQ7A Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ7X-96-2-US", manufacturer: "Enphase Energy", productName: "IQ7X Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ7PD-72", manufacturer: "Enphase Energy", productName: "IQ7PD-72 Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ7PD-84", manufacturer: "Enphase Energy", productName: "IQ7PD-84 Microinverter", category: "Microinverter", subcategory: "IQ7", generation: "IQ7", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Microinverters: IQ8 ---
  { sku: "IQ8-60-2-US", manufacturer: "Enphase Energy", productName: "IQ8 Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8PLUS-72-2-US", manufacturer: "Enphase Energy", productName: "IQ8+ Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8M", manufacturer: "Enphase Energy", productName: "IQ8M Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8MC-72-M-US", manufacturer: "Enphase Energy", productName: "IQ8MC Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "High", verificationStatus: "Verified" },
  { sku: "IQ8AC-72-M-US", manufacturer: "Enphase Energy", productName: "IQ8AC Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8HC-72-M-US", manufacturer: "Enphase Energy", productName: "IQ8HC Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8X-80-M-US", manufacturer: "Enphase Energy", productName: "IQ8X Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8P-72-2-US", manufacturer: "Enphase Energy", productName: "IQ8P Microinverter", category: "Microinverter", subcategory: "IQ8", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ8P-3P-72-E-US", manufacturer: "Enphase Energy", productName: "IQ8P-3P Commercial Microinverter", category: "Microinverter", subcategory: "IQ8 Commercial", generation: "IQ8", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Microinverters: IQ9 (UK) ---
  { sku: "IQ9N-A-INT", manufacturer: "Enphase Energy", productName: "IQ9N Microinverter", category: "Microinverter", subcategory: "IQ9", generation: "IQ9", region: "United Kingdom", voltageClass: "230 V", confidence: "High", verificationStatus: "Verified" },

  // --- Gateways ---
  { sku: "ENVOY", manufacturer: "Enphase Energy", productName: "Legacy Envoy", category: "Gateway", subcategory: "Envoy", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "ENVOY-R", manufacturer: "Enphase Energy", productName: "Envoy-R", category: "Gateway", subcategory: "Envoy", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "ENVOY-S-STANDARD", manufacturer: "Enphase Energy", productName: "Envoy-S Standard", category: "Gateway", subcategory: "Envoy-S", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "ENVOY-S-METERED", manufacturer: "Enphase Energy", productName: "Envoy-S Metered", category: "Gateway", subcategory: "Envoy-S", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-GATEWAY", manufacturer: "Enphase Energy", productName: "IQ Gateway", category: "Gateway", subcategory: "IQ Gateway", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-GATEWAY-METERED", manufacturer: "Enphase Energy", productName: "IQ Gateway Metered", category: "Gateway", subcategory: "IQ Gateway", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-GATEWAY-COM-PRO", manufacturer: "Enphase Energy", productName: "IQ Gateway Commercial Pro", category: "Gateway", subcategory: "Commercial", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Combiners ---
  { sku: "IQ-COMBINER-3", manufacturer: "Enphase Energy", productName: "IQ Combiner 3", category: "Combiner", subcategory: "IQ Combiner", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-COMBINER-4", manufacturer: "Enphase Energy", productName: "IQ Combiner 4", category: "Combiner", subcategory: "IQ Combiner", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-COMBINER-5", manufacturer: "Enphase Energy", productName: "IQ Combiner 5", category: "Combiner", subcategory: "IQ Combiner", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-COMBINER-5C", manufacturer: "Enphase Energy", productName: "IQ Combiner 5C", category: "Combiner", subcategory: "IQ Combiner", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "X-IQ-AM1-240-6C", manufacturer: "Enphase Energy", productName: "IQ Combiner 6C", category: "Combiner", subcategory: "IQ Combiner", generation: "Generation 4", region: "North America", voltageClass: "240 V", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- System Controllers ---
  { sku: "IQ-SC1", manufacturer: "Enphase Energy", productName: "IQ System Controller", category: "System Controller", subcategory: "Controller", generation: "Generation 1", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-SC2", manufacturer: "Enphase Energy", productName: "IQ System Controller 2", category: "System Controller", subcategory: "Controller", generation: "Generation 2", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-SC3", manufacturer: "Enphase Energy", productName: "IQ System Controller 3", category: "System Controller", subcategory: "Controller", generation: "Generation 3", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "SC200G111C240US01", manufacturer: "Enphase Energy", productName: "IQ System Controller 3G", category: "System Controller", subcategory: "Controller", generation: "Generation 3", region: "North America", voltageClass: "240 V", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-SC3M", manufacturer: "Enphase Energy", productName: "IQ System Controller 3M", category: "System Controller", subcategory: "Controller", generation: "Generation 3", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-SMART-SWITCH", manufacturer: "Enphase Energy", productName: "IQ Smart Switch", category: "System Controller", subcategory: "Smart Switch", generation: "Generation 4", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Batteries ---
  { sku: "ENCHARGE-3", manufacturer: "Enphase Energy", productName: "Encharge 3", category: "Battery", subcategory: "Encharge", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "ENCHARGE-10", manufacturer: "Enphase Energy", productName: "Encharge 10", category: "Battery", subcategory: "Encharge", generation: "Legacy", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-BATTERY-3T", manufacturer: "Enphase Energy", productName: "IQ Battery 3T", category: "Battery", subcategory: "IQ Battery", generation: "Generation 3", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-BATTERY-10T", manufacturer: "Enphase Energy", productName: "IQ Battery 10T", category: "Battery", subcategory: "IQ Battery", generation: "Generation 3", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-BATTERY-5P", manufacturer: "Enphase Energy", productName: "IQ Battery 5P", category: "Battery", subcategory: "IQ Battery", generation: "Generation 3", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-BATTERY-10C", manufacturer: "Enphase Energy", productName: "IQ Battery 10C", category: "Battery", subcategory: "IQ Battery", generation: "Generation 4", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Metering / Load Control / EV ---
  { sku: "IQ-METER-COLLAR", manufacturer: "Enphase Energy", productName: "IQ Meter Collar", category: "Metering", subcategory: "Meter Collar", generation: "Generation 4", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-LOAD-CONTROLLER", manufacturer: "Enphase Energy", productName: "IQ Load Controller", category: "Load Control", subcategory: "Load Controller", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-EV-CHARGER-2", manufacturer: "Enphase Energy", productName: "IQ EV Charger 2", category: "EV Charger", subcategory: "EVSE", generation: "Generation 2", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-EVSE-NA-1060-1101-1430", manufacturer: "Enphase Energy", productName: "IQ Bidirectional EV Charger", category: "EV Charger", subcategory: "Bidirectional EVSE", generation: "Generation 1", region: "North America", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Current Transformers ---
  { sku: "CT-PRODUCTION", manufacturer: "Enphase Energy", productName: "Production Current Transformer", category: "Current Transformer", subcategory: "Production CT", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "CT-CONSUMPTION", manufacturer: "Enphase Energy", productName: "Consumption Current Transformer", category: "Current Transformer", subcategory: "Consumption CT", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Communication / Control Cable ---
  { sku: "CTRL-SC3-NA-01", manufacturer: "Enphase Energy", productName: "Enphase Control Cable", category: "Communication Cable", subcategory: "Control Cable", generation: "Generation 4", region: "North America", voltageClass: "Unknown", confidence: "High", verificationStatus: "Verified" },

  // --- Connectors / Cable Accessories / Tools ---
  { sku: "Q-CONN-10M", manufacturer: "Enphase Energy", productName: "IQ Field Wireable Connector Male", category: "Connector", subcategory: "Field Wireable", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "Q-CONN-10F", manufacturer: "Enphase Energy", productName: "IQ Field Wireable Connector Female", category: "Connector", subcategory: "Field Wireable", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-TERMINATOR", manufacturer: "Enphase Energy", productName: "IQ Cable Terminator", category: "Cable Accessory", subcategory: "Terminator", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-SEALING-CAP", manufacturer: "Enphase Energy", productName: "IQ Sealing Cap", category: "Cable Accessory", subcategory: "Sealing Cap", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-DISCONNECT-TOOL", manufacturer: "Enphase Energy", productName: "IQ Disconnect Tool", category: "Tool", subcategory: "Disconnect Tool", generation: "IQ", region: "Multiple", voltageClass: "Unknown", confidence: "Medium", verificationStatus: "Needs Review" },

  // --- Trunk Cable ---
  { sku: "IQ-CABLE-240-PORTRAIT", manufacturer: "Enphase Energy", productName: "IQ Cable 240 V Portrait", category: "Trunk Cable", subcategory: "IQ Cable", generation: "IQ", region: "North America", voltageClass: "240 V", confidence: "Medium", verificationStatus: "Needs Review" },
  { sku: "IQ-CABLE-240-LANDSCAPE", manufacturer: "Enphase Energy", productName: "IQ Cable 240 V Landscape", category: "Trunk Cable", subcategory: "IQ Cable", generation: "IQ", region: "North America", voltageClass: "240 V", confidence: "Medium", verificationStatus: "Needs Review" }
];

/**
 * Find a catalog record by exact SKU (case-sensitive, per the workbook's own
 * "preserve SKU case" import rule).
 */
export function findBySku(sku) {
  return COMPATIBILITY_CATALOG.find((p) => p.sku === sku) || null;
}

/**
 * Best-effort identification of which catalog SKU (if any) a piece of free text refers to,
 * matching on productName as a whole-word phrase (same "2+ meaningful words, whole-word
 * subsequence" discipline used by draftEngine.js's own findPhraseMatch() -- reimplemented
 * standalone here so this module has no dependency on draftEngine.js's private functions).
 * Returns an array since text can legitimately mention more than one product.
 */
const STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with", "one"]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function containsSubsequence(haystackTokens, needleTokens) {
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return false;
  for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
    let matches = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export function findMentionedProducts(text) {
  const haystackTokens = tokenize(text);
  if (haystackTokens.length === 0) return [];
  const matches = [];
  for (const product of COMPATIBILITY_CATALOG) {
    const needleTokens = tokenize(product.productName);
    if (needleTokens.length < 2) continue; // same 2+-meaningful-word safeguard as draftEngine.js
    if (containsSubsequence(haystackTokens, needleTokens)) {
      matches.push(product);
    }
  }
  return matches;
}
