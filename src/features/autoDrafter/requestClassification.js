import {suggestPanelRequestType} from "./panelRequestClassification.js";
import {getRequestRoutingFlags} from "./requestRoutingFlags.js";
import {quoteRequestCommentEvidence} from "../quoteRequestIntake/quoteRequestComment.js";
import {parseQuoteRequestCase} from "./parseQuoteRequestCase.js";
import {isPlaceholderItemName} from "./pvModuleRecognition.js";
import {findCategoryCaseOverride, findCategoryRule} from "./categoryLearning.js";

export const REQUEST_TYPES = [
  {value: "panel_rma_only", label: "Panel RMA", tone: "amber"},
  {value: "panel_and_quote", label: "Panel RMA + On-Demand", tone: "orange"},
  {value: "enphase_rma", label: "Enphase RMA", tone: "blue"},
  {value: "enphase_and_quote", label: "Enphase RMA + On-Demand", tone: "teal"},
  {value: "lpup_tpup", label: "LPUP/TPUP", tone: "violet"},
  {value: "enphase_care", label: "Enphase Care", tone: "green"},
  {value: "on_demand", label: "On-Demand only", tone: "neutral"},
  {value: "unclassified", label: "Unclassified", tone: "rose"}
];

function category(type, reason, hasPanelRequest = false, reviewNotes = []) {
  return {...REQUEST_TYPES.find(option => option.value === type), type, reason, hasPanelRequest, reviewNotes};
}

export function requestCategoryCounts(classifications) {
  const counts = new Map();
  for (const classification of classifications) counts.set(classification.type, (counts.get(classification.type) || 0) + 1);
  return REQUEST_TYPES.map(option => ({...option, count: counts.get(option.value) || 0}))
    .sort((a, b) => b.count - a.count);
}
const CARE = /\benphase\s+care\b|\bcare\s+(?:plan|subscription|enrol(?:l)?ment)\b/i;
const CARE_INTENT = /\b(?:subscri|enrol|plan|renew|quote|consult|upsell|options?)/i;

// Enphase Care subscription/enrollment requests carry no products or field work; they go to the Care
// team instead of being priced as On-Demand quotes.
export function isEnphaseCareRequest(comment) {
  const text = String(comment || "");
  const {request} = parseQuoteRequestCase(text);
  const real = items => (items || []).filter(item => !isPlaceholderItemName(item.name));
  const services = real(request.services).map(item => item.name);
  if (real(request.products).length || real(request.materials).length || real(request.warrantyReplacements).length) return false;
  const structured = Boolean(request.scopeDescription || request.problemDescription || services.length);
  const scope = request.scopeDescription || (structured ? "" : text);
  const scopeIsCare = CARE.test(scope) && CARE_INTENT.test(scope);
  if (services.length) return services.every(name => CARE.test(name)) && (scopeIsCare || !scope.trim() || CARE.test(scope));
  return scopeIsCare;
}

// The text a learned category rule is matched against: the requested work, not the findings.
function requestedWorkText(comment) {
  const {request} = parseQuoteRequestCase(comment);
  const names = [...request.products, ...request.materials, ...request.services, ...request.warrantyReplacements]
    .map(item => item.name).filter(Boolean);
  const text = [request.scopeDescription, ...names].filter(Boolean).join("\n");
  return text || String(comment || "");
}

function corrected(automatic, type, correction, source) {
  const option = REQUEST_TYPES.find(item => item.value === type);
  if (!option || type === automatic.type) return {...automatic, learned: correction ? {...correction, source, matchesAutomatic: true} : null};
  const by = correction.taughtBy ? ` by ${correction.taughtBy}` : "";
  const reason = source === "case"
    ? `Category corrected${by}${correction.note ? `: ${correction.note}` : "."}`
    : `Learned rule${by}: requests mentioning "${correction.phrase}" are ${option.label}.`;
  return {...automatic, ...option, type, reason, reviewNotes: [], automaticType: automatic.type,
    learned: {...correction, source}};
}

// Reviewer corrections (categoryLearning.js) win over the automatic category: a per-case correction
// first, then the most specific learned phrase rule.
export function classifyQuoteRequest(comment, quoteLineItems = [], {caseNumber} = {}) {
  const automatic = classifyAutomatically(comment, quoteLineItems);
  const key = caseNumber || parseQuoteRequestCase(comment).request.caseNumber;
  const override = key ? findCategoryCaseOverride(key) : null;
  if (override) return corrected(automatic, override.category, override, "case");
  const rule = findCategoryRule(requestedWorkText(comment));
  if (rule) return corrected(automatic, rule.category, rule, "rule");
  return automatic;
}

function classifyAutomatically(comment, quoteLineItems = []) {
  if (isEnphaseCareRequest(comment)) {
    return category("enphase_care", "Enphase Care subscription or enrollment request with no products or field work. Route to the Care team instead of drafting an On-Demand quote.");
  }
  const panel = suggestPanelRequestType(comment, quoteLineItems);
  const notes = [];
  if (panel.reviewCode === "panel_and_device_rma") {
    return category("panel_rma_only", "Panel RMA plus another device RMA, without separate paid work.", true,
      ["Another device RMA is included. Submit the panel and device RMAs separately."]);
  }
  if (panel.reviewCode === "panel_rma_unconfirmed") {
    notes.push("PV panels are requested, but a panel RMA is not confirmed. Confirm whether the panels are paid or a warranty claim.");
  } else if (panel.type !== "no_panel") {
    return category(panel.type, panel.reason, true);
  }
  const hasPanelRequest = panel.type !== "no_panel";
  const flags = getRequestRoutingFlags(comment, null);
  const rma = flags.find(flag => flag.code === "microinverter_rma" || flag.code === "warranty_replacement" || flag.code === "enphase_rma_review");
  if (rma) {
    const {request} = parseQuoteRequestCase(comment);
    const scope = request.scopeDescription || (!request.problemDescription && !request.quoteCategory &&
      !request.products.length && !request.warrantyReplacements.length ? String(comment || "") : "");
    const devices = [scope, ...[...request.products, ...request.warrantyReplacements].map(item => item.name)].join("\n");
    const enphase = /\b(?:enphase|IQ[678](?:[A-Z+]+)?|M(?:190|210|215|250)|IQ\s+(?:gateway|combiner|relay|battery)|envoy)\b/i.test(devices);
    const device = /\b(?:enphase\s+(?:devices?|equipment)|micro[ -]?inverters?|IQ[678](?:[A-Z+]+)?|M(?:190|210|215|250)|gateways?|envoys?|combiners?|relays?|batter(?:y|ies))\b/i;
    const extraParts = [...request.products, ...request.materials].some(item => !device.test(item.name));
    const extraServices = request.services.some(item => /\b(?:paid|billable|on[ -]demand)\b/i.test(item.name) ||
      !device.test(item.name) && !/\b(?:replacement|installation|labor|testing|verification|commissioning)\b/i.test(item.name));
    const positiveScope = scope.split(/[.;\n]/)
      .filter(line => !/\b(?:no|not|without)\b/i.test(line)).join("\n");
    const paidWork = /\b(?:wiring|rewir(?:e|ing)|cabling|cables?|connectors?|breakers?|critter\s+guard|electrical\s+correction|on[ -]demand|billable|paid\s+(?:work|labor)|additional\s+(?:quote|work|materials))\b/i.test(positiveScope);
    if (enphase && (extraParts || extraServices || paidWork)) {
      return category("enphase_and_quote", "Enphase replacement/RMA scope plus separate quoted materials, services or paid work. Verify warranty/Care coverage and keep the RMA work separate from the On-Demand portion.", hasPanelRequest, notes);
    }
    if (enphase) {
      return category("enphase_rma", "Enphase device replacement/RMA scope. Verify device serials, warranty and Care coverage before treating this as a paid purchase.", hasPanelRequest, notes);
    }
    notes.push("Device replacement/RMA scope detected, but the manufacturer is not established. Verify the manufacturer and warranty before quoting it as paid work.");
  }
  const upgrade = flags.find(flag => flag.code === "lpup_tpup");
  if (!rma && upgrade) return category("lpup_tpup", upgrade.reason, hasPanelRequest, notes);
  if (!quoteRequestCommentEvidence(comment).hasRequest) {
    return category("unclassified", "The requested work could not be identified from the request comment. Confirm the scope before generating a draft.", hasPanelRequest, notes);
  }
  return category("on_demand", "Paid On-Demand work; no confirmed panel RMA, Enphase RMA or LPUP/TPUP routing detected.", hasPanelRequest, notes);
}
