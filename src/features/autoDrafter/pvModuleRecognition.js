// Recognizes requested PV modules (solar panels) by name. Technicians rarely write "PV Module":
// real requests say "REC Alpha Pure REC395AA Pure Solar Module", "Qcells Q.PEAK DUO BLK ML-G10+ 400
// Solar Module" or just "Solar Module". Almost anything named "module" is a PV module, so the rule
// is: a module/solar panel/known panel brand, unless the name is clearly an accessory, another
// device's module (battery, comms, controller...) or a service line.

const MODULE_PHRASE = /\bmodules?\b/i;
const GENERIC_PANEL_PHRASE = /\b(?:solar|pv|photovoltaic)[\s-]*panels?\b/i;

const PANEL_BRANDS = new RegExp([
  "\\bREC\\s*(?:Alpha|TwinPeak|N-?Peak|Pure)", "\\bREC\\s*\\d{3}", "\\bQ\\.?\\s*(?:PEAK|CELLS|PLUS|TRON)\\b",
  "\\bq\\s*cells\\b", "\\bhanwha\\b", "\\bsolaria\\b", "\\bpowerxt\\b", "\\bsunpower\\b", "\\bmaxeon\\b",
  "\\bLG\\s*NeON\\b", "\\bsilfab\\b", "\\bcanadian\\s+solar\\b", "\\btrina\\b", "\\bjinko\\b", "\\blongi\\b",
  "\\bmission\\s+solar\\b", "\\bheliene\\b", "\\baxitec\\b", "\\bboviet\\b", "\\bwaaree\\b", "\\bznshine\\b",
  "\\bsuntech\\b", "\\bsuniva\\b", "\\bpanasonic\\s+(?:hit|evervolt)\\b", "\\bmeyer\\s+burger\\b",
  "\\bja\\s+solar\\b", "\\byingli\\b", "\\bfirst\\s+solar\\b", "\\bcertainteed\\b", "\\bhyundai\\s+solar\\b", "\\bsolartech\\b"
].join("|"), "i");

const ACCESSORY = /\b(?:clips?|clamps?|rails?|racking|mounts?|mounting|brackets?|cables?|cabling|cords?|connectors?|pitch|frames?|fasteners?|harness(?:es)?|plates?|jumpers?|extensions?|adapters?|labels?|caps?|terminators?|critter|guards?|skirts?|screens?|mesh|flashing|hardware|wire|wiring|bird)\b/i;

const OTHER_DEVICE = /\b(?:batter(?:y|ies)|bms|comms?|communications?|cell(?:ular)?|modem|wi-?fi|zigbee|controllers?|control|relays?|meters?|cts?|boards?|gateways?|envoy|enpower|encharge|ensemble|storage|power\s+module|memory|radio|display|interface|micro(?:inverters?)?|inverters?|optimi[sz]ers?|IQ\s*\d|IQ\s*(?:gateway|combiner|battery|relay|system))\b/i;

// "Solar Module Replacement" / "Module-level diagnostics" / "Replace module" read as services. On a
// Products or Additional Materials line, though, "Solaria PV Module Replacement" is the replacement
// module itself, so only the leading-verb and "-level" forms are excluded there.
const SERVICE_SUFFIX = /\b(?:modules?|panels?)[\s-]+(?:replacement|removal|reinstall(?:ation)?|installation|troubleshooting|diagnostics?|diagnosis|testing|inspection|evaluation|labor|service|cleaning|swap|consultation)\b/i;
const SERVICE_ALWAYS = /\b(?:modules?|panels?)[\s-]+level\b|^(?:replace|remove|reinstall|install|troubleshoot|diagnose|test|inspect|evaluate|clean|swap)\b/i;
const SERVICES_TAX_CODE = "SS300220";

// A priced quote line that is a service (catalog service or unmatched $0 service line).
export function isServiceLine(item) {
  return Boolean(item?.zero_priced_service || item?.tax_code === SERVICES_TAX_CODE);
}

const PLACEHOLDER = /^(?:none|none required|n\/?a|unknown|tbd|to be determined|other|misc(?:ellaneous)?)\.?$/i;

export function isPlaceholderItemName(name) {
  return !String(name || "").trim() || PLACEHOLDER.test(String(name).trim());
}

let learnedPvModulePhrases = [];

// Reviewer-taught "this phrase is a PV module" rules (categoryLearning.js) loaded at runtime.
export function setLearnedPvModulePhrases(phrases = []) {
  learnedPvModulePhrases = [...new Set(phrases.map(phrase => String(phrase || "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean))];
}

// "AC module" is a PV module with an integrated microinverter (e.g. Solaria PowerXT-355R AC).
// Pass {product: true} for Products / Additional Materials lines and non-service quote lines.
// Pass {genericPanels: false} to ignore a bare "Solar panel", which can be new-install material
// rather than a replacement module (routing then relies on the scope and RMA evidence).
export function isPvModuleName(name, {product = false, genericPanels = true} = {}) {
  const text = String(name || "").trim();
  if (!text || isPlaceholderItemName(text)) return false;
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  if (learnedPvModulePhrases.some(phrase => lower.includes(phrase))) return true;
  if (ACCESSORY.test(text) || SERVICE_ALWAYS.test(text) || !product && SERVICE_SUFFIX.test(text)) return false;
  if (/\bac\s+modules?\b/i.test(text)) return true;
  if (OTHER_DEVICE.test(text)) return false;
  return MODULE_PHRASE.test(text) || PANEL_BRANDS.test(text) || genericPanels && GENERIC_PANEL_PHRASE.test(text);
}

// Service lines that only remove, replace, test or troubleshoot the module itself. These belong to
// the panel job and do not make it a mixed Panel RMA + On-Demand request.
export function isPvModuleHandlingService(name) {
  const text = String(name || "").trim();
  if (!text) return false;
  if (/^(?:labor|installation|array removal and reinstallation)$/i.test(text)) return true;
  return /\b(?:modules?|(?:solar|pv|photovoltaic)[\s-]*panels?|array)\b/i.test(text) && !ACCESSORY.test(text) &&
    !OTHER_DEVICE.test(text.replace(/\bac\s+modules?\b/gi, "module")) &&
    /\b(?:rma|replac(?:e|ement)|removal|reinstall(?:ation)?|troubleshoot(?:ing)?|diagnos(?:e|is|tics?)|testing|inspection|evaluation)\b/i.test(text);
}
