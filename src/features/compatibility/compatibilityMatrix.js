// compatibilityMatrix.js
//
// Directional product-to-product compatibility rules, keyed by SKU (see
// compatibilityCatalog.js). Source: EnQuote_Enphase_Installation_Catalog.xlsx,
// "Compatibility_Matrix" sheet -- every row below is transcribed directly from that
// sheet, unmodified. Nothing here was inferred or invented.
//
// Compatibility is NOT automatically reversible: Direction "One Way" means the rule
// applies exactly as Source_SKU -> Target_SKU and must never be evaluated in reverse
// (see workbook README / handoff Section 3.3).
//
// Target_SKU "MANUAL-ENGINEERING-REVIEW" is a workbook sentinel value, not a real
// product -- it means "no automatic replacement target exists; a human must select and
// verify the replacement."

export const COMPATIBILITY_MATRIX = [
  {
    id: "CMP-4EFAC67E63",
    sourceSku: "IQ8MC-72-M-US",
    targetSku: "IQ7-60-2-US",
    compatibilityType: "Mixed-System Compatibility",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "Solar-only or specified solar-plus-battery configurations",
    confidence: "High",
    restriction: "IQ8 may be added to an existing IQ7 system only under documented configurations; reverse addition is restricted. Mixed systems may lose IQ8-specific features.",
    sourceDocumentId: "SRC-DSH-00049-6-0",
    verificationStatus: "Verified"
  },
  {
    id: "CMP-81F40BFBCB",
    sourceSku: "IQ8MC-72-M-US",
    targetSku: "IQ7PLUS-72-2-US",
    compatibilityType: "Mixed-System Compatibility",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "Solar-only or specified solar-plus-battery configurations",
    confidence: "High",
    restriction: "Gateway and system configuration validation required.",
    sourceDocumentId: "SRC-DSH-00049-6-0",
    verificationStatus: "Verified"
  },
  {
    id: "CMP-2FB4DC7F00",
    sourceSku: "IQ9N-A-INT",
    targetSku: "IQ7-60-2-US",
    compatibilityType: "Mixed-System Compatibility",
    direction: "One Way",
    region: "United Kingdom",
    systemConfiguration: "Documented IQ7/IQ8/IQ9 configurations",
    confidence: "High",
    restriction: "IQ9N can be added under documented configurations; older series cannot be added to a site with existing IQ9N on the same gateway.",
    sourceDocumentId: "SRC-DSH-00748-1-0",
    verificationStatus: "Verified"
  },
  {
    id: "CMP-A03BE4A893",
    sourceSku: "IQ9N-A-INT",
    targetSku: "IQ8MC-72-M-US",
    compatibilityType: "Mixed-System Compatibility",
    direction: "One Way",
    region: "United Kingdom",
    systemConfiguration: "Documented IQ8/IQ9 configurations",
    confidence: "High",
    restriction: "Region-specific planning and feature restrictions apply.",
    sourceDocumentId: "SRC-DSH-00748-1-0",
    verificationStatus: "Verified"
  },
  {
    id: "CMP-20266A15C0",
    sourceSku: "M175",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-C72E57E9FA",
    sourceSku: "M190",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-2FBCBB0DE6",
    sourceSku: "M210",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-DEC12CE2C6",
    sourceSku: "M215",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-9C3580193E",
    sourceSku: "M250",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-27A562065C",
    sourceSku: "S230",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-A708A75FE6",
    sourceSku: "S280",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-97E2E4B49D",
    sourceSku: "IQ6",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-94D16C2709",
    sourceSku: "IQ6PLUS",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-EDD64300E0",
    sourceSku: "IQ7-60-2-US",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-31A6C625B9",
    sourceSku: "IQ7PLUS-72-2-US",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-47555FAE48",
    sourceSku: "IQ7A-72-2-US",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  },
  {
    id: "CMP-BC19EFA598",
    sourceSku: "IQ7X-96-2-US",
    targetSku: "MANUAL-ENGINEERING-REVIEW",
    compatibilityType: "Replacement Review Required",
    direction: "One Way",
    region: "North America",
    systemConfiguration: "O&M replacement",
    confidence: "Low",
    restriction: "Do not auto-select a replacement. Verify trunk cable, connector, gateway, branch circuit, grid profile, module electrical compatibility, and current Enphase replacement policy.",
    sourceDocumentId: null,
    verificationStatus: "Draft"
  }
];

/**
 * Returns every matrix row where sourceSku matches exactly (respecting Direction --
 * "One Way" rows are only ever looked up by their real sourceSku, never reverse-looked-up
 * by targetSku, per the workbook's own non-reversible-compatibility rule).
 */
export function findCompatibilityRules(sourceSku) {
  return COMPATIBILITY_MATRIX.filter((row) => row.sourceSku === sourceSku);
}

/**
 * Returns the specific rule (if any) for an exact sourceSku -> targetSku pair.
 */
export function findCompatibilityRule(sourceSku, targetSku) {
  return COMPATIBILITY_MATRIX.find((row) => row.sourceSku === sourceSku && row.targetSku === targetSku) || null;
}
