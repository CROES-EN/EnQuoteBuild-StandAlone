// productDependencyMatrix.js
//
// Product-to-product dependency rules, keyed by SKU (see compatibilityCatalog.js).
// Source: EnQuote_Enphase_Installation_Catalog.xlsx, "Product_Dependencies" sheet --
// every row below is transcribed directly from that sheet, unmodified.
//
// This is a SEPARATE, independently-populated system from
// src/features/quoteDraftAgent/componentDependencies.js (which encodes the SAME 3
// repair-scoped rules -- Combiner 6C control cable, IQ8 advisory accessories, legacy
// microinverter warning -- already reviewed against this workbook and confirmed
// correct). This file is the fuller, broader source dataset behind those three rules,
// plus additional real dependency rows (Gateway CT monitoring, Battery/Controller
// backup config, EVSE breaker placeholder) not yet wired into the live Draft Engine.
// Nothing here is auto-added to a quote by itself -- see requirementLevel below and the
// Draft Engine's own auto-add/advisory/warning gates.
//
// requirementLevel meanings (per workbook Lists sheet):
//   Required    - include only when verified and applicable
//   Conditional - evaluate the stated "appliesWhen" condition before inclusion
//   Recommended - display as a recommendation, never a silent addition
//   Optional    - do not add by default

export const PRODUCT_DEPENDENCY_MATRIX = [
  // --- IQ8 (base) ---
  { id: "DEP-969D004BE9", parentSku: "IQ8-60-2-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-D1DCE2536F", parentSku: "IQ8-60-2-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-6050D7102A", parentSku: "IQ8-60-2-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-D8CCF82E56", parentSku: "IQ8-60-2-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-5663BFD9DC", parentSku: "IQ8-60-2-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8+ ---
  { id: "DEP-8F4F7002E2", parentSku: "IQ8PLUS-72-2-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-BEBFF78B4D", parentSku: "IQ8PLUS-72-2-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-4E2DF77313", parentSku: "IQ8PLUS-72-2-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-9742294EC3", parentSku: "IQ8PLUS-72-2-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-56F19C4FD8", parentSku: "IQ8PLUS-72-2-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8MC ---
  { id: "DEP-3C2AD9583F", parentSku: "IQ8MC-72-M-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-B0012F11E4", parentSku: "IQ8MC-72-M-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-18927366FE", parentSku: "IQ8MC-72-M-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-D61E7E994C", parentSku: "IQ8MC-72-M-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-17111FD8E5", parentSku: "IQ8MC-72-M-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8AC ---
  { id: "DEP-FB37B01DB0", parentSku: "IQ8AC-72-M-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-1846EE6BC1", parentSku: "IQ8AC-72-M-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-CC8C7F1C72", parentSku: "IQ8AC-72-M-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-F9FF9908CB", parentSku: "IQ8AC-72-M-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-A1648FD216", parentSku: "IQ8AC-72-M-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8HC ---
  { id: "DEP-617265190C", parentSku: "IQ8HC-72-M-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-2FB21AEED2", parentSku: "IQ8HC-72-M-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-EF1882F97A", parentSku: "IQ8HC-72-M-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-70FDB7049B", parentSku: "IQ8HC-72-M-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-FB8FB8AE1A", parentSku: "IQ8HC-72-M-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8X ---
  { id: "DEP-C3419260B4", parentSku: "IQ8X-80-M-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-19640B3221", parentSku: "IQ8X-80-M-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-5E633EAF98", parentSku: "IQ8X-80-M-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-5ECDD7C8A9", parentSku: "IQ8X-80-M-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-EEA4FB8DAD", parentSku: "IQ8X-80-M-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ8P ---
  { id: "DEP-4C4DBFD537", parentSku: "IQ8P-72-2-US", childSku: "IQ-CABLE-240-PORTRAIT", relationshipType: "Installed With", requirementLevel: "Required", quantity: 1, quantityFormula: "CEILING(Module_Count / Connectors_Per_Cable_Section)", appliesWhen: "Portrait module layout", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Needs Review" },
  { id: "DEP-9D6B893784", parentSku: "IQ8P-72-2-US", childSku: "IQ-GATEWAY", relationshipType: "Monitored By", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per site", appliesWhen: "When gateway is not integrated into another enclosure", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-1A28D08112", parentSku: "IQ8P-72-2-US", childSku: "IQ-TERMINATOR", relationshipType: "Branch Accessory", requirementLevel: "Required", quantity: 1, quantityFormula: "1 per cable section", appliesWhen: "At unterminated IQ Cable end", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-64B3C7D0D5", parentSku: "IQ8P-72-2-US", childSku: "IQ-SEALING-CAP", relationshipType: "Branch Accessory", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Unused_Connectors", appliesWhen: "For every unused IQ Cable connector", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },
  { id: "DEP-CD8956ABED", parentSku: "IQ8P-72-2-US", childSku: "IQ-DISCONNECT-TOOL", relationshipType: "Service Tool", requirementLevel: "Recommended", quantity: 1, quantityFormula: "1 per crew", appliesWhen: "For connector disconnection", region: "North America", confidence: "High", sourceDocumentId: "SRC-USM-00008-3-0", verificationStatus: "Verified" },

  // --- IQ Combiner 6C / metering / battery / controller / EVSE ---
  { id: "DEP-54B1390E93", parentSku: "X-IQ-AM1-240-6C", childSku: "CTRL-SC3-NA-01", relationshipType: "Communicates With", requirementLevel: "Required", quantity: 1, quantityFormula: "Route_Length", appliesWhen: "When connected to IQ Battery 10C or IQ Meter Collar", region: "North America", confidence: "High", sourceDocumentId: "SRC-0782709F19", verificationStatus: "Verified", notes: "Source states third-party control cable may not operate reliably." },
  { id: "DEP-28F685506E", parentSku: "X-IQ-AM1-240-6C", childSku: "CT-CONSUMPTION", relationshipType: "Measures With", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Per approved configuration", appliesWhen: "When external consumption CTs are used", region: "North America", confidence: "High", sourceDocumentId: "SRC-0782709F19", verificationStatus: "Verified" },
  { id: "DEP-D46A4680C7", parentSku: "IQ-GATEWAY", childSku: "CT-PRODUCTION", relationshipType: "Measures With", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Per system design", appliesWhen: "Production monitoring configuration", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-6340A15107", verificationStatus: "Needs Review" },
  { id: "DEP-9AA47D0F2A", parentSku: "IQ-GATEWAY-METERED", childSku: "CT-CONSUMPTION", relationshipType: "Measures With", requirementLevel: "Conditional", quantity: 2, quantityFormula: "Per service conductors", appliesWhen: "Consumption monitoring configuration", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-6340A15107", verificationStatus: "Needs Review" },
  { id: "DEP-1677F881F3", parentSku: "IQ-BATTERY-5P", childSku: "IQ-SC3", relationshipType: "Controlled By", requirementLevel: "Conditional", quantity: 1, quantityFormula: "1 per site", appliesWhen: "Backup configuration", region: "North America", confidence: "Medium", sourceDocumentId: null, verificationStatus: "Needs Review" },
  { id: "DEP-7B007F6CC4", parentSku: "IQ-BATTERY-10C", childSku: "X-IQ-AM1-240-6C", relationshipType: "Integrated With", requirementLevel: "Conditional", quantity: 1, quantityFormula: "1 per site", appliesWhen: "Generation 4 configuration", region: "North America", confidence: "Medium", sourceDocumentId: "SRC-348EFE9DFB", verificationStatus: "Needs Review" },
  { id: "DEP-1518BEEDE9", parentSku: "IQ-EVSE-NA-1060-1101-1430", childSku: "GEN-BRK-2P-60-A", relationshipType: "Protected By", requirementLevel: "Conditional", quantity: 1, quantityFormula: "Per design", appliesWhen: null, region: "North America", confidence: "Low", sourceDocumentId: "SRC-140-00591-01", verificationStatus: "Draft", notes: "Placeholder only; exact breaker and conductor must follow released QIG and site design" }
];

/**
 * Returns every dependency row for a given parent SKU.
 */
export function findDependencies(parentSku) {
  return PRODUCT_DEPENDENCY_MATRIX.filter((row) => row.parentSku === parentSku);
}

/**
 * Convenience filter: only rows at or above a minimum requirement level's "weight" --
 * useful for callers that only want Required (auto-add candidates) vs. everything else.
 */
const LEVEL_WEIGHT = { Required: 3, Conditional: 2, Recommended: 1, Optional: 0 };

export function findDependenciesAtLevel(parentSku, minLevel = "Optional") {
  const minWeight = LEVEL_WEIGHT[minLevel] ?? 0;
  return findDependencies(parentSku).filter((row) => (LEVEL_WEIGHT[row.requirementLevel] ?? 0) >= minWeight);
}
