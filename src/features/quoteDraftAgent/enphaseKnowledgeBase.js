/**
 * Built-in Enphase reference data, curated from public enphase.com data sheets. Every value
 * below is copied from the cited document; nothing is inferred. Add an entry only when its
 * source states the fact, and update `revision` when a newer data sheet changes a value.
 *
 * Used for: spec summaries on draft line items, sourced review checks (branch limits, IQ7/IQ8
 * mixing), and the "Enphase reference" results in the Find in Catalog dialog.
 */
import {PRODUCT_CATALOG} from "./productCatalog";

export const ENPHASE_SOURCES = {
  iq8: {title: "IQ8 Series Microinverters data sheet", revision: "DSH-00378-5.0 (2026-07-13)", url: "https://enphase.com/download/iq8-series-microinverters-data-sheet"},
  iq8x: {title: "IQ8X Microinverter data sheet", revision: "DSH-00185-8.0 (2026-07-24)", url: "https://enphase.com/download/iq8x-microinverter-data-sheet"},
  iq7: {title: "IQ7 and IQ7+ Microinverters data sheet", revision: "IQ7-IQ7plus-DS-EN-US", url: "https://enphase.com/installers/resources/documentation"},
  iq7a: {title: "IQ7A Microinverter data sheet", revision: "2019-11-07", url: "https://media-store.enphase.com/productattach/i/q/iq_7a_microinverter_datasheet.pdf"},
  cable: {title: "IQ Cable accessories data sheet", revision: "DSH-00247-1.0 (2024-07-03)", url: "https://enphase.com/download/iq-cable-and-accessories-data-sheet"},
  gateway: {title: "IQ Gateway data sheet", revision: "ENV-IQ-AM1-240", url: "https://enphase.com/download/iq-gateway-data-sheet"}
};

const micro = (entry) => ({kind: "microinverter", dcConnector: "MC4", ...entry});

export const ENPHASE_PRODUCTS = [
  micro({id: "iq8h-208", name: "IQ8H-208 Microinverter", sku: "IQ8H-208-72-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8\s*h[\s-]*208\b/, peakVA: 366, continuousVA: 360, maxPerBranch: 9, branchVoltage: "208 V single-phase", modulePairing: "295-500 W", maxDcVoltage: 60, mppt: "36-45 V",
    note: "Operates in grid-tied mode only at 208 VAC."}),
  micro({id: "iq8h-240", name: "IQ8H-240 Microinverter", sku: "IQ8H-240-72-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8\s*h(?![\s-]*208)\b/, peakVA: 384, continuousVA: 380, maxPerBranch: 10, branchVoltage: "240 V", modulePairing: "320-540 W", maxDcVoltage: 60, mppt: "36-45 V"}),
  micro({id: "iq8x", name: "IQ8X Microinverter", sku: "IQ8X-80-M-US", generation: "IQ8", source: "iq8x",
    pattern: /\biq\s*8\s*x\b/, peakVA: 384, continuousVA: 384, maxPerBranch: 10, branchVoltage: "240 V (9 at 208 V)", modulePairing: "320-540 W", maxDcVoltage: 79.5, mppt: "43-60 V",
    note: "Maximum module Isc 13 A."}),
  micro({id: "iq8a", name: "IQ8A Microinverter", sku: "IQ8A-72-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8\s*a\b/, peakVA: 366, continuousVA: 349, maxPerBranch: 11, branchVoltage: "240 V", modulePairing: "295-500 W", maxDcVoltage: 60, mppt: "32-45 V"}),
  micro({id: "iq8m", name: "IQ8M Microinverter", sku: "IQ8M-72-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8\s*m\b/, peakVA: 330, continuousVA: 325, maxPerBranch: 11, branchVoltage: "240 V", modulePairing: "260-460 W", maxDcVoltage: 60, mppt: "30-45 V"}),
  micro({id: "iq8plus", name: "IQ8+ Microinverter", sku: "IQ8PLUS-72-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8\s*(\+|plus\b)/, peakVA: 300, continuousVA: 295, maxPerBranch: 13, branchVoltage: "240 V", modulePairing: "235-440 W", maxDcVoltage: 60, mppt: "27-45 V"}),
  micro({id: "iq8", name: "IQ8 Microinverter", sku: "IQ8-60-2-US", generation: "IQ8", source: "iq8",
    pattern: /\biq\s*8(?!\s*(\+|plus\b)|[a-z])/, peakVA: 245, continuousVA: 240, maxPerBranch: 16, branchVoltage: "240 V", modulePairing: "235-350 W", maxDcVoltage: 50, mppt: "27-37 V"}),
  micro({id: "iq7a", name: "IQ7A Microinverter", sku: "IQ7A-72-2-US", generation: "IQ7", source: "iq7a",
    pattern: /\biq\s*7\s*a\b/, peakVA: 366, continuousVA: 349, maxPerBranch: 11, branchVoltage: "240 V (11 at 208 V)", modulePairing: "295-460 W", maxDcVoltage: 58, mppt: "18-58 V",
    note: "Maximum module Isc 15 A."}),
  micro({id: "iq7plus", name: "IQ7+ Microinverter", sku: "IQ7PLUS-72-2-US", generation: "IQ7", source: "iq7",
    pattern: /\biq\s*7\s*(\+|plus\b)/, peakVA: 295, continuousVA: 290, maxPerBranch: 13, branchVoltage: "240 V (11 at 208 V)", modulePairing: "235-440 W", maxDcVoltage: 60, mppt: "27-45 V"}),
  micro({id: "iq7", name: "IQ7 Microinverter", sku: "IQ7-60-2-US", generation: "IQ7", source: "iq7",
    pattern: /\biq\s*7(?!\s*(\+|plus\b)|[a-z])/, peakVA: 250, continuousVA: 240, maxPerBranch: 16, branchVoltage: "240 V (13 at 208 V)", modulePairing: "235-350 W", maxDcVoltage: 48, mppt: "27-37 V",
    dcConnector: "MC4 (Amphenol H4 UTX with the Q-DCC-5 adapter)", note: "60-cell / 120 half-cell modules only."}),

  {id: "q-12-10-240", kind: "cable", name: "IQ Cable, 1.3 m (4.2 ft) connector spacing", sku: "Q-12-10-240", source: "cable",
    pattern: /\bq-?12-?10-?240\b/, note: "12 AWG, 240 connectors per box. Typical portrait spacing."},
  {id: "q-12-17-240", kind: "cable", name: "IQ Cable, 2.0 m (6.5 ft) connector spacing", sku: "Q-12-17-240", source: "cable",
    pattern: /\bq-?12-?17-?240\b/, note: "12 AWG, 240 connectors per box. Typical landscape spacing."},
  {id: "q-12-20-200", kind: "cable", name: "IQ Cable, 2.3 m (7.5 ft) connector spacing", sku: "Q-12-20-200", source: "cable",
    pattern: /\bq-?12-?20-?200\b/, note: "12 AWG, 200 connectors per box."},
  {id: "q-12-raw-300", kind: "accessory", name: "IQ Raw Cable (300 m, no connectors)", sku: "Q-12-RAW-300", source: "cable",
    pattern: /\bq-?12-?raw\b|\biq raw cable\b/, note: "300 meters of 12 AWG cable with no connectors."},
  {id: "q-conn-10m", kind: "accessory", name: "IQ Field Wireable Connector (male)", sku: "Q-CONN-10M", source: "cable",
    pattern: /\bq-?conn-?10m\b|field wireable.*\b(plug|male)\b/, note: "Make connections from any open connector."},
  {id: "q-conn-10f", kind: "accessory", name: "IQ Field Wireable Connector (female)", sku: "Q-CONN-10F", source: "cable",
    pattern: /\bq-?conn-?10f\b|field wireable.*\b(socket|female)\b/, note: "Make connections from any IQ Cable open connector."},
  {id: "q-clip-100", kind: "accessory", name: "IQ Cable Clip", sku: "Q-CLIP-100", source: "cable",
    pattern: /\bq-?clip-?100\b|\biq cable clips?\b/, note: "Fastens cabling to the racking or secures looped cabling."},
  {id: "q-disc-10", kind: "accessory", name: "IQ Disconnect Tool", sku: "Q-DISC-10", source: "cable",
    pattern: /\bq-?disc-?10\b|\bdisconnect tool\b/, note: "For IQ Cable connectors, DC connectors and AC module mounts."},
  {id: "q-seal-10", kind: "accessory", name: "IQ Sealing Cap (female)", sku: "Q-SEAL-10", source: "cable",
    pattern: /\bq-?seal-?10\b|\biq sealing cap\b/, note: "One needed to cover each unused connector on the cabling."},
  {id: "q-term-10", kind: "accessory", name: "IQ Terminator", sku: "Q-TERM-10", source: "cable",
    pattern: /\bq-?term-?10\b|\biq terminator\b/, note: "Terminates unused cable ends."},
  {id: "eca-en4-s22", kind: "accessory", name: "EN4 to MC4 adapter (150 mm)", sku: "ECA-EN4-S22", source: "cable",
    pattern: /\beca-?en4-?s22\b(?!-)|\ben4 to mc4\b/, note: "Connects PV modules with MC4 connectors to IQ Microinverters with EN4 connectors."},
  {id: "iq-gateway", kind: "gateway", name: "IQ Gateway", sku: "ENV-IQ-AM1-240", source: "gateway",
    pattern: /\benv2?-?iq-?am1-?240\b|\biq gateway\b(?! pcb)/, note: "Install indoors, or outdoors in a NEMA type 3R or better enclosure. Typical consumption 5 W."}
];

function searchable(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ");
}

/** Best reference entry for a line item name or SKU, or null. */
export function findEnphaseProduct(name, sku = "") {
  const text = searchable(`${name || ""} ${sku || ""}`);
  if (!text.trim()) return null;
  const bySku = ENPHASE_PRODUCTS.find((entry) => text.includes(entry.sku.toLowerCase()));
  return bySku || ENPHASE_PRODUCTS.find((entry) => entry.pattern.test(text)) || null;
}

export function enphaseSource(entry) {
  return entry ? ENPHASE_SOURCES[entry.source] || null : null;
}

/** One-line summary for a line item, e.g. "IQ8M-72-2-US · 330 VA peak · max 11 per 20 A branch". */
export function enphaseSpecSummary(entry) {
  if (!entry) return "";
  if (entry.kind !== "microinverter") return [entry.sku, entry.note].filter(Boolean).join(" · ");
  return [entry.sku, `${entry.peakVA} VA peak`, `max ${entry.maxPerBranch} per 20 A branch (${entry.branchVoltage})`, `modules ${entry.modulePairing}`].join(" · ");
}

/** Catalog item that already sells this reference product, if any. */
export function catalogItemForEnphaseProduct(entry, catalog = PRODUCT_CATALOG) {
  if (!entry) return null;
  const sku = entry.sku.toLowerCase();
  return catalog.find((item) => String(item.sku || "").toLowerCase() === sku)
    || catalog.find((item) => findEnphaseProduct(item.name, item.sku)?.id === entry.id) || null;
}

/** Reference entries that match a free-text search (every word must appear). */
export function searchEnphaseReference(term) {
  const words = searchable(term).split(/[^a-z0-9+]+/).filter(Boolean);
  if (!words.length) return [];
  const direct = findEnphaseProduct(term);
  const matches = ENPHASE_PRODUCTS.filter((entry) => {
    const haystack = searchable(`${entry.name} ${entry.sku} ${entry.note || ""} ${entry.generation || ""}`);
    return words.every((word) => haystack.includes(word));
  });
  return direct && !matches.includes(direct) ? [direct, ...matches] : matches;
}

/**
 * Sourced review notes for a draft, computed from its current line items and request text.
 * Informational only: nothing here changes prices or quantities.
 */
export function enphaseSpecChecks(items = [], requestText = "") {
  const checks = [];
  const lines = (items || []).map((item) => ({item, entry: findEnphaseProduct(item?.name, item?.sku)})).filter((line) => line.entry);
  for (const {item, entry} of lines) {
    const source = enphaseSource(entry);
    const quantity = Number(item.quantity) || 0;
    if (entry.kind === "microinverter" && quantity > entry.maxPerBranch) {
      const circuits = Math.ceil(quantity / entry.maxPerBranch);
      checks.push({id: `branch:${entry.id}`, triggerItem: item.name, source,
        reason: `The data sheet allows at most ${entry.maxPerBranch} ${entry.name}s per 20 A branch circuit (${entry.branchVoltage}). ${quantity} units need at least ${circuits} branch circuits; confirm the site's branch layout.`});
    }
  }
  const quoted = new Set(lines.filter((line) => line.entry.kind === "microinverter").map((line) => line.entry.generation));
  const mentioned = new Set();
  for (const [generation, pattern] of [["IQ7", /\biq\s*7/], ["IQ8", /\biq\s*8/]]) {
    if (pattern.test(searchable(requestText))) mentioned.add(generation);
  }
  const iq8Source = ENPHASE_SOURCES.iq8;
  if (quoted.has("IQ8") && (quoted.has("IQ7") || mentioned.has("IQ7"))) {
    checks.push({id: "mix:iq8-into-iq7", triggerItem: "IQ8 with IQ7", source: iq8Source,
      reason: "IQ8 can join an existing IQ7 system on the same gateway only for Solar Only, or Solar + Battery (IQ Battery 3/10 or 5P) with IQ System Controller 3/3G/3M and IQ Meter Collar. A mixed system does not support IQ8-only features such as PCS or Sunlight Jump Start."});
  }
  if (quoted.has("IQ7") && mentioned.has("IQ8")) {
    checks.push({id: "mix:iq7-into-iq8", triggerItem: "IQ7 with IQ8", source: iq8Source,
      reason: "IQ7 microinverters cannot be added to a site that already has IQ8 microinverters on the same gateway. Quote an IQ8 replacement instead."});
  }
  for (const item of items || []) {
    if (item?.confidence !== "low") continue;
    const entry = findEnphaseProduct(item.requested_name || item.name);
    if (!entry || catalogItemForEnphaseProduct(entry)) continue;
    checks.push({id: `reference:${entry.id}:${item.name}`, triggerItem: item.name, source: enphaseSource(entry),
      reason: `Enphase reference: ${entry.name} (${entry.sku}) is not in the price list. Use Find in Catalog > Add product to price it once; later drafts reuse it.`});
  }
  return checks;
}
