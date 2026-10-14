import {parseQuoteRequestCase} from "./parseQuoteRequestCase.js";
import {isMicroinverterMention, mentionsCompetingMicroinverterBrand, isAffirmative, indicatesActiveWarrantyOrRma} from "../quoteDraftAgent/requestDeviceEvidence.js";

const GATEWAY = /\b(?:IQ\s+gateways?|gateways?|envoys?)\b/i;
const DEVICE = /\b(?:micro[ -]?inverters?|IQ[678](?:[A-Z+]+)?|M(?:190|210|215|250)|IQ\s+(?:gateways?|combiners?|relays?|batter(?:y|ies))|envoys?|enphase\s+(?:devices?|equipment|batter(?:y|ies)))\b/i;
const EXTRA_WORK = /\b(?:solar\s+panels?|pv\s+modules?|panel\s+rma|wiring|rewir(?:e|ing)|cables?|connectors?|breakers?|conduit|critter\s+guard|racking|roof|upgrades?|add(?:itional)?\s+(?:materials|equipment|work))\b/i;
const REPLACEMENT = /\breplac(?:e|es|ement|ements|ing)\b|\brma\b/i;
const PURCHASE = /\b(?:upgrad(?:e|es|ing)|purchas(?:e|es|ing)|buy|new installation|lpup|tpup|conversion|convert)\b/i;

export function getRequestRoutingFlags(comment, careEligibility) {
  const text = String(comment || "");
  const {request} = parseQuoteRequestCase(text);
  const scope = request.scopeDescription || text;
  const items = [...request.products, ...request.materials, ...request.services];
  const warrantyItems = request.warrantyReplacements || [];
  const requested = [scope, ...items.map(item => item.name), ...warrantyItems.map(item => item.name)].join("\n");
  const microRequested = isMicroinverterMention(requested);
  const purchaseText = [scope, ...items.map(item => item.notes || "")].join("\n")
    .replace(/\b(?:no|not|without)\s+(?:an?\s+)?(?:upgrades?|purchases?|conversion|lpup(?:\/tpup)?|tpup)\b/gi, "");
  const purchase = PURCHASE.test(purchaseText);
  const competingDevice = mentionsCompetingMicroinverterBrand([scope, request.problemDescription, request.rootCause].join("\n"));
  const enphasePurchaseItems = items.some(item => isMicroinverterMention(item.name) && !mentionsCompetingMicroinverterBrand(item.name));
  const microWarranty = warrantyItems.filter(item => isMicroinverterMention(item.name));
  const confirmedRma = isAffirmative(request.rmaRequired) ||
    microWarranty.some(item => indicatesActiveWarrantyOrRma(item.rmaRequired, item.warrantyStatus));
  const rmaRejected = /^(?:no|false|not required)$/i.test(request.rmaRequired || "") && !confirmedRma;
  const microReplacement = REPLACEMENT.test(scope) && (isMicroinverterMention(scope) || /\benphase\s+devices?\b/i.test(scope));
  const microRmaReview = microRequested && !purchase && !rmaRejected &&
    (!competingDevice || !enphasePurchaseItems) && (microWarranty.length > 0 || confirmedRma || microReplacement);
  const flags = [];
  if (microRmaReview) {
    flags.push({code: "microinverter_rma", label: "Microinverter RMA review",
      reason: competingDevice ? "Non-Enphase replacement scope detected. Verify the manufacturer's warranty/RMA process; do not assume Enphase coverage or LPUP/TPUP purchase routing." :
        "Replacement/RMA scope detected, not a confirmed purchase or upgrade. Verify device warranty and RMA eligibility before pricing; do not route this as LPUP/TPUP."});
  } else if (microRequested) {
    flags.push({code: "lpup_tpup", label: "LPUP/TPUP", reason: "Microinverter purchase/upgrade scope detected. Review LPUP/TPUP routing; this is not proof of warranty coverage."});
  }
  const deviceReplacement = !purchase && !competingDevice && !rmaRejected &&
    (REPLACEMENT.test(scope) || warrantyItems.length > 0 || confirmedRma) && DEVICE.test(requested);
  const deviceOnly = deviceReplacement && !EXTRA_WORK.test(requested) &&
    [...items, ...warrantyItems].every(item => DEVICE.test(item.name) || /\b(?:labor|replacement|installation|testing|verification)\b/i.test(item.name) && !EXTRA_WORK.test(item.name));
  if (!deviceReplacement) return flags;
  const gateway = GATEWAY.test(requested);
  if (!deviceOnly) {
    if (!microRmaReview) flags.push({code: "enphase_rma_review", label: "Enphase RMA review",
      reason: "Enphase device replacement is requested with additional work. Verify warranty/RMA eligibility and separate any On-Demand work before pricing."});
    if (gateway) flags.push({code: "gateway_warranty", label: "Gateway/Envoy: check warranty",
      reason: "Verify Gateway/Envoy warranty separately; do not apply the 20-25 year serial-device rule."});
    return flags;
  }
  const hasSerial = /\bserial(?:\s+(?:number|no\.?|numbers)(?:\(s\))?)?\s*[:#]\s*(?!unknown\b|none\b|n\/a\b)[a-z0-9-]{5,}\b/i.test(text) ||
    /\b(?:SN|S\/N)\s*[:#]\s*(?!unknown\b|none\b|n\/a\b)[a-z0-9-]{5,}\b/i.test(text);
  flags.push({
    code: "warranty_replacement", label: "Enphase warranty replacement",
    reason: gateway ? "Device-only replacement. Gateway/Envoy warranty must be checked separately." :
      `Device-only replacement under the team's 20-25 year serial-device review rule. ${hasSerial ? "Serial supplied; verify device and warranty dates." : "Collect device serials and verify warranty dates."}`
  });
  if (gateway) flags.push({code: "gateway_warranty", label: "Gateway/Envoy: check warranty", reason: "Do not apply the 20-25 year device assumption to IQ Gateways or Envoys. Verify their warranty."});
  if (careEligibility?.status === "ACTIVE_CARE") {
    flags.push({code: "enphase_care", label: "Enphase Care", reason: "Active Care subscription found in the imported report. Review warranty-replacement coverage; subscription status does not verify device warranty."});
  } else if (careEligibility?.status === "NO_ACTIVE_CARE") {
    flags.push({code: "inside_sales", label: "Inside Sales: Care upsell", reason: "The imported subscription record is not active. Review a Care upsell with Inside Sales before arranging warranty-related replacement service."});
  } else {
    flags.push({code: "verify_care", label: "Verify Care / Inside Sales review", reason: "No verified Care coverage available from the imported report. Confirm coverage first; if absent, refer to Inside Sales for a Care upsell."});
  }
  return flags;
}
