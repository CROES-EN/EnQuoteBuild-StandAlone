import {parseQuoteRequestCase} from "./parseQuoteRequestCase.js";
import {isAffirmative, indicatesActiveWarrantyOrRma} from "../quoteDraftAgent/requestDeviceEvidence.js";
import {isPlaceholderItemName, isPvModuleHandlingService, isPvModuleName, isServiceLine} from "./pvModuleRecognition.js";

export const REQUEST_TYPES = [
  {value: "panel_rma_only", label: "Panel RMA only"},
  {value: "panel_and_quote", label: "Panel + On-Demand Quote"},
  {value: "panel_review", label: "Panels mentioned - review"},
  {value: "no_panel", label: "No panel request"}
];

const PANEL_ACCESSORIES = /\b(?:(?:solar|pv|photovoltaic)\s+)?panels?\s+(?:clips?|clamps?|leads?|wiring|cabling|cables?|connectors?|mounts?|racking|frames?|rails?|fasteners?)\b/gi;
const EXTRA_WORK = /\b(?:wiring|rewir(?:e|ing)|microinverters?|IQ[678][A-Z+]*|gateways?|combiners?|envoy|cabling|cables?|connectors?|breakers?|critter\s+guard|electrical\s+correction)\b/i;
const PAID_WORK = /\b(?:on[ -]demand|billable|paid\s+(?:labor|work)|additional\s+(?:quote|work|materials))\b/i;
const RMA_NEGATION = /\b(?:no|not|without)\s+(?:panel\s+)?(?:rma|warranty)\b|\brma\s+(?:not\s+required|is\s+not\s+required)\b/i;

function panelText(text) {
  return String(text || "").replace(/\b(?:electrical|service|breaker|distribution|main|sub)[ -]?panels?\b/gi, "")
    .replace(PANEL_ACCESSORIES, "");
}

function mentionsPanels(text) {
  return /\b(?:panels?|(?:pv|solar|photovoltaic)\s+modules?)\b/i.test(panelText(text));
}

function panelHandlingService(item) {
  return isPvModuleHandlingService(item.name) || !EXTRA_WORK.test(item.name) && !PAID_WORK.test(item.name) && (
    /^(?:labor|installation|array removal and reinstallation)$/i.test(item.name) ||
    mentionsPanels(item.name) && /\b(?:rma|replac(?:e|ement)|removal|reinstallation)\b/i.test(item.name));
}

export function suggestPanelRequestType(comment, quoteLineItems = []) {
  const text = String(comment || "");
  const {request} = parseQuoteRequestCase(text);
  const parts = [...request.products, ...request.materials];
  const sourceItems = [...parts, ...request.services].filter(item => !isPlaceholderItemName(item.name));
  const currentItems = quoteLineItems.filter(item => !isPlaceholderItemName(item.name));
  // Services are never the module itself ("Solar Module Replacement" is the job, not the part).
  const isPvModule = item => !request.services.includes(item) && !isServiceLine(item) && isPvModuleName(item.name, {product: true, genericPanels: false});
  const modules = [...sourceItems, ...currentItems].filter(isPvModule);
  if (modules.length) {
    const quotedItems = currentItems.length ? currentItems : sourceItems;
    const mixed = quotedItems.some(item => !isPvModule(item) && !panelHandlingService(item));
    const origin = currentItems.some(isPvModule) ? "current quote" : "imported request";
    const moduleName = String(modules[0].name).trim();
    const rmaNote = /^no$/i.test(String(request.rmaRequired || "").trim())
      ? " The request says RMA Required: No - confirm whether this is a warranty claim or a paid replacement."
      : "";
    return {
      type: mixed ? "panel_and_quote" : "panel_rma_only",
      reason: mixed
        ? `PV module (${moduleName}) detected in the ${origin}, along with other quoted items. Route as Panel RMA + On-Demand and review the separate work; manufacturer eligibility and coverage still require verification.${rmaNote}`
        : `PV module (${moduleName}) detected in the ${origin}. Route as Panel RMA; manufacturer eligibility and coverage still require verification.${rmaNote}`
    };
  }
  const warranty = request.warrantyReplacements || [];
  const structured = Boolean(request.scopeDescription || request.problemDescription || request.diagnosticFindings ||
    request.quoteCategory || parts.length || request.services.length || warranty.length);
  const scope = request.scopeDescription || (structured ? "" : text);
  const panelParts = parts.filter(item => mentionsPanels(item.name));
  const panelWarranty = warranty.filter(item => mentionsPanels(item.name));
  const scopeMentionsPanel = mentionsPanels(scope);
  const positiveScope = panelText(scope).split(/[.!?;\n]/).filter(line => !RMA_NEGATION.test(line)).join("\n");
  const explicitPanelRma = /\b(?:panels?|(?:pv|solar|photovoltaic)\s+modules?)\s+(?:rma|warranty)\b/i.test(positiveScope) ||
    /\b(?:rma(?:\s+(?:claim|replacement))?|warranty\s+(?:claim|replacement))(?:\s+(?:of|for|the|damaged|failed|cracked|broken|\d+))*\s+(?:panels?|(?:pv|solar|photovoltaic)\s+modules?)\b/i.test(positiveScope);
  const panelReplacement = /\breplac(?:e|es|ing|ement\s+(?:of|for))\s+(?:(?:the|damaged|failed|cracked|broken|affected|existing|solar|pv|\d+)\s+){0,6}(?:panels?|(?:pv|solar|photovoltaic)\s+modules?)\b/i.test(positiveScope) ||
    /\b(?:panels?|(?:pv|solar|photovoltaic)\s+modules?)\s+(?:(?:need|needs|require|requires)\s+)?replacement\b/i.test(positiveScope);
  const otherDeviceRma = warranty.some(item => !mentionsPanels(item.name) &&
    indicatesActiveWarrantyOrRma(item.rmaRequired, item.warrantyStatus));
  const panelRma = explicitPanelRma || panelWarranty.some(item => indicatesActiveWarrantyOrRma(item.rmaRequired, item.warrantyStatus)) ||
    isAffirmative(request.rmaRequired) && !otherDeviceRma && (panelReplacement || panelParts.length > 0);
  const extraParts = parts.filter(item => !mentionsPanels(item.name));
  const extraServices = request.services.filter(item => !panelHandlingService(item));
  const extraWork = extraParts.length > 0 || extraServices.length > 0 || EXTRA_WORK.test(scope) || PAID_WORK.test(scope);
  const panelAccessOnly = /\b(?:remov(?:e|al|ing)|reinstall(?:ation|ing)?|access)\b/i.test(scope) && !panelReplacement && !explicitPanelRma;

  if (!panelParts.length && !panelWarranty.length && !panelRma &&
      (!scopeMentionsPanel || panelAccessOnly || RMA_NEGATION.test(scope) && extraWork)) {
    return {type: "no_panel", reason: "No PV panel parts or panel RMA requested. Installed panels, panel accessories and array-access work do not count as panel replacements."};
  }
  if (!panelRma) {
    return {type: "panel_review", reviewCode: "panel_rma_unconfirmed", reason: "PV panels are requested or mentioned in the scope, but a panel RMA is not confirmed. Do not assume this is a panel RMA or a mixed RMA/quote request."};
  }
  const source = panelWarranty.length ? "Warranty Replacements" : explicitPanelRma ? "the requested scope" : "requested panel parts and RMA Required";
  const unpricedNote = !panelParts.length ? " An RMA panel need not appear among priced quote line items." : "";
  if (extraWork) {
    return {type: "panel_and_quote", reason: `Panel RMA identified in ${source}, plus separate quoted materials, services or paid work.${unpricedNote}`};
  }
  if (otherDeviceRma) {
    return {type: "panel_review", reviewCode: "panel_and_device_rma", reason: "Panel and other-device RMAs detected, without confirmed separate paid work. Review routing; this is not a panel-only RMA or a confirmed mixed paid quote."};
  }
  return {type: "panel_rma_only", reason: `Panel RMA identified in ${source}, without separate quoted work.${unpricedNote} Verify manufacturer eligibility before submitting.`};
}
