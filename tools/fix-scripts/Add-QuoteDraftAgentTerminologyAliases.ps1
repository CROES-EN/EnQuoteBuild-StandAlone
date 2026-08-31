$ErrorActionPreference = "Stop"

Write-Host "=== Making the Quote Draft Agent (Step 2) parser resilient to terminology variations ==="
Write-Host ""
Write-Host "This update teaches the parser to recognize field labels the way BOTH the"
Write-Host "Step 1 (Quote Request Agent) prompt and the Step 2 (Quote Draft Agent) prompt"
Write-Host "phrase them, since Step 2 may echo some of Step 1's original wording:"
Write-Host "  - Technician Count            (alias for Number of FSTs Needed)"
Write-Host "  - Estimated Onsite Labor Hours (alias for Number of Labor Hours on Site --"
Write-Host "                                  NOT Estimated Total Labor Hours, which can"
Write-Host "                                  include travel time and would overstate it)"
Write-Host "  - Total Drive Hours            (alias for Total Travel Hours combined)"
Write-Host "  - Total Drive Miles            (alias for Miles Traveled combined)"
Write-Host "  - Scope Description            (alias for Scope of Work Description)"
Write-Host "  - Customer Name                (alias for Customer)"
Write-Host ""
Write-Host "Also fixes:"
Write-Host "  - Bullet characters (bullet dots, etc.) are now stripped along with hyphens,"
Write-Host "    since live agent output sometimes uses these instead of hyphens."
Write-Host "  - Ranges like '1-2' now resolve to the worst-case (higher) value, matching"
Write-Host "    the Quote Draft Agent's own stated worst-case rule."
Write-Host "  - Values of 'Unknown', 'N/A', 'None', 'TBD', etc. are now treated as not"
Write-Host "    found (so they correctly become 'Requires Manual Input') instead of being"
Write-Host "    copied into the form literally."
Write-Host ""
Write-Host "IMPORTANT SAFEGUARD (unchanged): pasted text is still only accepted if it"
Write-Host "contains real evidence of pricing (dollar amounts, a Materials Total, tax"
Write-Host "codes, etc.). Pure Step 1 output -- even though it shares many field labels --"
Write-Host "is still rejected with guidance to run it through the Step 2 agent first."
Write-Host ""

$parserPath = ".\src\features\quoteDraftAgent\quoteDraftTextParser.js"
$buttonPath = ".\src\features\quoteDraftAgent\QuoteDraftButton.jsx"

if (-not (Test-Path $parserPath)) {
  Write-Error "Could not find $parserPath. Run this from your EnQuote project root."
  exit 1
}
if (-not (Test-Path $buttonPath)) {
  Write-Error "Could not find $buttonPath. Run this from your EnQuote project root."
  exit 1
}

# -------------------------------------------------------------------------
# quoteDraftTextParser.js
# -------------------------------------------------------------------------
@'
// quoteDraftTextParser.js
//
// Parses the plain-text output printed by the Quote Draft Agent (Step 2)
// into a structured object that maps directly onto the required EnQuote
// form fields. Pure text parsing -- no API calls, no Base44, no LLM.
//
// TERMINOLOGY ROBUSTNESS
// Step 2 takes Step 1 (Quote Request Agent) output as its input, and may
// echo some of Step 1's field labels verbatim (e.g. "Technician Count:",
// "Estimated Onsite Labor Hours:", "Total Drive Hours:") rather than always
// reformatting into the "QUOTE BUILD PACKAGE" style. This parser recognizes
// both label styles per field so it works regardless of which wording the
// live agent actually prints.
//
// SAFEGUARD: Because Step 1 output alone can contain many of these same
// labels (Site ID, Case Number, Technician Count, etc.) but has NO pricing
// or tax codes, this parser also checks for direct evidence that pricing
// was actually generated (dollar amounts, a Materials/Labor Table, tax
// codes, etc.) before accepting the input as genuine Step 2 output. Pure
// Step 1 text -- even though it shares label names -- is still rejected
// with guidance to run it through the Step 2 agent first.

const MATERIAL_SECTION_NAMES = [
  "Trunk Cable Repair Materials",
  "Electrical Materials",
  "Critter Guard Materials",
  "Communications Materials",
  "Battery Materials",
  "Monitoring Materials",
  "Weatherproofing Materials"
];

// Phrases that indicate a labeled value is a placeholder / not a real,
// usable value -- e.g. "Assigned at Scheduling", or the literal "Unknown"
// values Step 1 explicitly allows technicians to submit.
const UNKNOWN_VALUE_RE = /^(unknown|n\/?a|none|tbd|pending|not provided|not available|not assigned|unassigned|assigned at scheduling)$/i;

function isUnknownValue(value) {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  return UNKNOWN_VALUE_RE.test(trimmed);
}

// Returns the cleaned value, or null if it is empty/unknown-equivalent.
function cleanFieldValue(value) {
  if (isUnknownValue(value)) return null;
  return String(value).trim();
}

// Strips markdown emphasis, common bullet glyphs (-, *, bullet dot, etc.),
// non-breaking spaces (common when copying from Teams/Word/HTML), and
// trims whitespace.
function cleanLine(line) {
  return line
    .replace(/\u00A0/g, " ") // non-breaking space -> regular space
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^[-*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF]\s*/, "") // -, *, bullet glyphs
    .trim();
}

function toLines(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => cleanLine(l))
    .filter((l) => l.length > 0);
}

function findHeadingIndex(lines, startIdx, headingCandidates) {
  for (let i = startIdx; i < lines.length; i++) {
    const cleaned = lines[i].toLowerCase();
    for (const h of headingCandidates) {
      if (cleaned === h.toLowerCase()) return i;
    }
  }
  return -1;
}

function sectionSlice(lines, startHeadings, endHeadings, fromIdx = 0) {
  const startIdx = findHeadingIndex(lines, fromIdx, startHeadings);
  if (startIdx === -1) return { text: [] };
  const endIdx = findHeadingIndex(lines, startIdx + 1, endHeadings);
  const sliceEnd = endIdx === -1 ? lines.length : endIdx;
  return { text: lines.slice(startIdx + 1, sliceEnd) };
}

const CURRENCY_RE = /\$[\d,]+(?:\.\d{1,2})?/;
const QTY_RE = /^([\d.]+)\s*(hours?|hrs?|miles?|mi|each|ea)?$/i;

// Extracts a "Label: value" style line anywhere in the document, trying
// each alias in order and returning the first match found. Lines are
// assumed to already be cleaned (bullets/markdown stripped) via toLines().
function extractLabeledValue(lines, aliasLabels) {
  for (const alias of aliasLabels) {
    const re = new RegExp("^" + escapeRegex(alias) + ":\\s*(.+)$", "i");
    for (const line of lines) {
      const match = line.match(re);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parses a numeric value that may be a plain number ("6"), a range
// ("1-2", "1 to 2", "1 - 2"), or a decimal ("0.5"). Ranges resolve to the
// higher (worst-case) value, matching the Quote Draft Agent's own stated
// rule to "use worst-case labor estimates when a range is provided."
// Returns null if no usable number is found (e.g. the value is "Unknown").
function parseNumberOrRange(value) {
  if (value === null || value === undefined) return null;
  const cleaned = cleanFieldValue(value);
  if (cleaned === null) return null;

  const rangeMatch = cleaned.match(/([\d.]+)\s*(?:-|to)\s*([\d.]+)/i);
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    if (!isNaN(a) && !isNaN(b)) return Math.max(a, b);
  }

  const singleMatch = cleaned.match(/[\d.]+/);
  if (singleMatch) {
    const n = parseFloat(singleMatch[0]);
    if (!isNaN(n)) return n;
  }
  return null;
}

// --- Alias lists -----------------------------------------------------
const SITE_ID_ALIASES = ["Site ID"];
const CASE_NUMBER_ALIASES = ["Case Number"];
const CUSTOMER_ALIASES = ["Customer", "Customer Name"];
const SITE_ADDRESS_ALIASES = ["Site Address"];
const SERVICE_TYPE_ALIASES = ["Service Type", "Quote Category"];
const TECHNICIAN_NAME_ALIASES = ["Technician Name"];
const REQUESTED_BY_ALIASES = ["Requested By", "Quote Requester"];
const TECHNICIAN_COUNT_ALIASES = ["Technician Count", "Number of FSTs Needed", "FST Count"];
const ONSITE_LABOR_HOURS_ALIASES = ["Estimated Onsite Labor Hours", "Onsite Labor Hours"];
const TOTAL_LABOR_HOURS_TEXT_RE = /total labor hours:\s*([\d.]+(?:\s*(?:-|to)\s*[\d.]+)?)/i;
const DRIVE_HOURS_ALIASES = ["Total Drive Hours", "Total Travel Hours", "Drive Hours"];
const DRIVE_MILES_ALIASES = ["Total Drive Miles", "Miles Traveled", "Drive Miles", "Total Miles"];
const SCOPE_DESCRIPTION_ALIASES = ["Scope Description"];

// --- Evidence that this is genuine Step 2 (priced) output, not just a
// Step 1 request pasted directly. At least one of these must be present.
function hasQuoteDraftEvidence(rawText) {
  const text = rawText || "";
  const evidenceMarkers = [
    /quote\s*build\s*package/i,
    /materials?\s*total/i,
    /tax\s*code/i,
    /labor\s*table/i,
    /travel\s*table/i,
    /labor\s*&\s*travel\s*subtotal/i,
    /estimated\s*quote\s*total/i,
    /quote\s*summary/i,
    CURRENCY_RE
  ];
  return evidenceMarkers.some((pattern) => pattern.test(text));
}

function resolveValidUntil() {
  // Always 30 days from today, per business rule -- independent of any
  // date text that may appear in the pasted output.
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function resolveQuoteRequester(lines) {
  const explicit = cleanFieldValue(extractLabeledValue(lines, REQUESTED_BY_ALIASES));
  if (explicit) return explicit;
  const technicianName = cleanFieldValue(extractLabeledValue(lines, TECHNICIAN_NAME_ALIASES));
  if (technicianName) return technicianName;
  return "";
}

function parseScopeOfWork(lines) {
  // Priority 1: an explicit "Scope Description:" labeled line/paragraph
  // (Step 1 style, possibly echoed by Step 2).
  const labeled = cleanFieldValue(extractLabeledValue(lines, SCOPE_DESCRIPTION_ALIASES));
  if (labeled) return labeled;

  // Priority 2: a "Scope of Work" / "Recommended Scope of Work" section
  // (Step 2 "QUOTE BUILD PACKAGE" paragraph style).
  const { text } = sectionSlice(
    lines,
    ["Scope of Work", "Recommended Scope of Work"],
    ["Labor & Travel", "Labor and Travel", "Site Characteristics", "Access Requirements", "Materials"]
  );
  const joined = text.join(" ").trim();
  return cleanFieldValue(joined) || "";
}

function parseFourColumnTable(sectionLines) {
  const rows = [];
  const pipeRows = sectionLines.filter((l) => l.includes("|"));
  if (pipeRows.length >= 2) {
    for (const row of pipeRows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 4) continue;
      if (/^-+$/.test(cells[0])) continue;
      if (/^description$/i.test(cells[0])) continue;
      rows.push({ description: cells[0], quantity: cells[1], rate: cells[2], total: cells[3] });
    }
    return rows;
  }

  const filtered = sectionLines.filter((l) => l && !/^(description|quantity|rate|total)$/i.test(l));

  for (let i = 0; i + 3 < filtered.length + 1 && i < filtered.length; i += 4) {
    const chunk = filtered.slice(i, i + 4);
    if (chunk.length < 4) break;
    rows.push({ description: chunk[0], quantity: chunk[1], rate: chunk[2], total: chunk[3] });
  }
  return rows;
}

function parseQuantity(qtyStr) {
  if (!qtyStr) return { value: 0, unit: null };
  const match = qtyStr.trim().match(QTY_RE);
  if (match) {
    return { value: parseFloat(match[1]) || 0, unit: (match[2] || "").toLowerCase() };
  }
  const numMatch = qtyStr.match(/[\d.]+/);
  return { value: numMatch ? parseFloat(numMatch[0]) : 0, unit: null };
}

function parseCurrency(str) {
  if (!str) return 0;
  const match = str.match(CURRENCY_RE);
  if (!match) return 0;
  return parseFloat(match[0].replace(/[$,]/g, "")) || 0;
}

function parseLaborAndTravel(lines) {
  const { text: assumptionBlock } = sectionSlice(
    lines,
    ["Labor & Travel", "Labor and Travel"],
    ["Materials"]
  );
  const assumptionsText = assumptionBlock.join(" ");

  const laborTable = parseFourColumnTable(sectionSlice(lines, ["Labor Table"], ["Travel Table"]).text);
  const travelTable = parseFourColumnTable(
    sectionSlice(lines, ["Travel Table"], ["Labor & Travel Subtotal", "Materials"]).text
  );

  const labor = laborTable.map((row) => {
    const qty = parseQuantity(row.quantity);
    return { description: row.description, hours: qty.value, rate: parseCurrency(row.rate), total: parseCurrency(row.total) };
  });

  const travel = travelTable.map((row) => {
    const qty = parseQuantity(row.quantity);
    const isMileage = /mile/i.test(row.quantity) || /mileage/i.test(row.description);
    return {
      description: row.description,
      quantity: qty.value,
      unit: isMileage ? "miles" : "hours",
      rate: parseCurrency(row.rate),
      total: parseCurrency(row.total)
    };
  });

  // --- FST count: Technician Count label -> "N technician(s) assigned" -> table row fallback
  let fstCount = parseNumberOrRange(extractLabeledValue(lines, TECHNICIAN_COUNT_ALIASES));
  if (fstCount === null) {
    const technicianMatch = assumptionsText.match(/(\d+)\s*technician/i);
    fstCount = technicianMatch ? parseInt(technicianMatch[1], 10) : (labor.length ? 1 : 0);
  }

  // --- Labor hours on site: Onsite Labor Hours label (most specific) ->
  // "Estimated total labor hours:" phrase -> labor table sum
  let laborHours = parseNumberOrRange(extractLabeledValue(lines, ONSITE_LABOR_HOURS_ALIASES));
  if (laborHours === null) {
    const totalLaborMatch = assumptionsText.match(TOTAL_LABOR_HOURS_TEXT_RE);
    laborHours = totalLaborMatch ? parseNumberOrRange(totalLaborMatch[1]) : null;
  }
  if (laborHours === null) {
    laborHours = labor.reduce((sum, l) => sum + (l.hours || 0), 0) || null;
  }

  const laborRateMatch = assumptionsText.match(/labor rate assumed at\s*\$?([\d.]+)/i);

  // --- Travel hours combined: Total Drive Hours label -> travel table hour rows sum
  let travelHours = parseNumberOrRange(extractLabeledValue(lines, DRIVE_HOURS_ALIASES));
  if (travelHours === null) {
    const tableHours = travel.filter((t) => t.unit === "hours").reduce((sum, t) => sum + (t.quantity || 0), 0);
    travelHours = tableHours || null;
  }

  // --- Miles traveled combined: Total Drive Miles label -> travel table mile rows sum
  let milesTraveled = parseNumberOrRange(extractLabeledValue(lines, DRIVE_MILES_ALIASES));
  if (milesTraveled === null) {
    const tableMiles = travel.filter((t) => t.unit === "miles").reduce((sum, t) => sum + (t.quantity || 0), 0);
    milesTraveled = tableMiles || null;
  }

  return {
    fst_count: fstCount || 0,
    labor_hours: laborHours || 0,
    labor_rate: laborRateMatch ? parseFloat(laborRateMatch[1]) : (labor[0]?.rate || 0),
    travel_hours: travelHours || 0,
    travel_rate: travel.find((t) => t.unit === "hours")?.rate || 65,
    miles_traveled: milesTraveled || 0,
    mileage_rate: travel.find((t) => t.unit === "miles")?.rate || 0.73,
    labor,
    travel
  };
}

function parseMaterials(lines) {
  const { text: materialsBlock } = sectionSlice(lines, ["Materials"], ["Materials Total"]);
  const items = [];
  let currentSection = null;
  let buffer = [];

  const flush = () => {
    if (!currentSection || buffer.length === 0) { buffer = []; return; }
    const rows = parseThreeOrFourColumnMaterialRows(buffer);
    rows.forEach((r) => items.push({ ...r, section: currentSection }));
    buffer = [];
  };

  for (const line of materialsBlock) {
    if (!line) continue;
    const isKnownSection = MATERIAL_SECTION_NAMES.some((name) => name.toLowerCase() === line.toLowerCase());
    if (isKnownSection) {
      flush();
      currentSection = line;
      continue;
    }
    if (/subtotal/i.test(line)) continue;
    buffer.push(line);
  }
  flush();
  return items;
}

function parseThreeOrFourColumnMaterialRows(sectionLines) {
  const rows = [];
  const pipeRows = sectionLines.filter((l) => l.includes("|"));
  if (pipeRows.length >= 2) {
    for (const row of pipeRows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      if (/^-+$/.test(cells[0])) continue;
      if (/^item$/i.test(cells[0])) continue;
      rows.push(buildMaterialRow(cells));
    }
    return rows;
  }

  const filtered = sectionLines.filter((l) => !/^(item|qty|unit price|tax code)$/i.test(l));
  for (let i = 0; i < filtered.length; i += 4) {
    const chunk = filtered.slice(i, i + 4);
    if (chunk.length < 3) break;
    rows.push(buildMaterialRow(chunk));
  }
  return rows;
}

function buildMaterialRow(cells) {
  const name = cells[0];
  const qty = parseQuantity(cells[1]).value || parseFloat(cells[1]) || 1;
  const unitPrice = parseCurrency(cells[2]);
  const taxCode = cells[3] || null;
  return {
    product_id: null,
    name,
    quantity: qty,
    unit_price: unitPrice,
    total: Math.round(qty * unitPrice * 100) / 100,
    taxable: true,
    tax_code: taxCode
  };
}

function parseTotals(lines) {
  const joined = lines.join("\n");
  const materialsTotalMatch = joined.match(/Materials Total\s*\n?\$?([\d,.]+)/i);
  const laborTravelSubtotalMatch = joined.match(/Labor & Travel Subtotal\s*\n?\$?([\d,.]+)/i);
  const salesTaxMatch = joined.match(/Estimated Sales Tax:\s*\$?([\d,.]+)/i);
  const grandTotalMatch = joined.match(/Estimated Quote Total\s*\n?\$?([\d,.]+)/i);

  return {
    materials_total: materialsTotalMatch ? parseFloat(materialsTotalMatch[1].replace(/,/g, "")) : null,
    labor_travel_subtotal: laborTravelSubtotalMatch ? parseFloat(laborTravelSubtotalMatch[1].replace(/,/g, "")) : null,
    sales_tax: salesTaxMatch ? parseFloat(salesTaxMatch[1].replace(/,/g, "")) : null,
    total: grandTotalMatch ? parseFloat(grandTotalMatch[1].replace(/,/g, "")) : null
  };
}

function parseNamedSection(lines, startHeadings, endHeadings) {
  const { text } = sectionSlice(lines, startHeadings, endHeadings);
  return text.join("\n").trim();
}

export function parseQuoteDraftOutput(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Paste the Quote Draft Agent output before applying it.");
  }

  const lines = toLines(rawText);

  const scopeOfWork = parseScopeOfWork(lines);
  const laborTravel = parseLaborAndTravel(lines);
  const materials = parseMaterials(lines);
  const totals = parseTotals(lines);
  const internalNotes = parseNamedSection(lines, ["Internal Notes"], ["Risk Adjustment Statement", "END OF OUTPUT"]);
  const riskStatement = parseNamedSection(lines, ["Risk Adjustment Statement"], ["END OF OUTPUT"]);

  const siteId = cleanFieldValue(extractLabeledValue(lines, SITE_ID_ALIASES)) || "";
  const caseNumber = cleanFieldValue(extractLabeledValue(lines, CASE_NUMBER_ALIASES)) || "";
  const customer = cleanFieldValue(extractLabeledValue(lines, CUSTOMER_ALIASES)) || "";
  const siteAddress = cleanFieldValue(extractLabeledValue(lines, SITE_ADDRESS_ALIASES)) || "";
  const serviceType = cleanFieldValue(extractLabeledValue(lines, SERVICE_TYPE_ALIASES)) || "";
  const technicianName = cleanFieldValue(extractLabeledValue(lines, TECHNICIAN_NAME_ALIASES)) || "";

  return {
    site_id: siteId,
    case_number: caseNumber,
    customer,
    site_address: siteAddress,
    service_type: serviceType,
    technician_name: technicianName,
    quote_requester: resolveQuoteRequester(lines),
    valid_until: resolveValidUntil(),
    scope_of_work: scopeOfWork,
    fst_count: laborTravel.fst_count,
    labor_hours: laborTravel.labor_hours,
    labor_rate: laborTravel.labor_rate,
    travel_hours: laborTravel.travel_hours,
    travel_rate: laborTravel.travel_rate,
    miles_traveled: laborTravel.miles_traveled,
    mileage_rate: laborTravel.mileage_rate,
    labor_mode: "hourly",
    items: materials,
    materials_total: totals.materials_total,
    labor_travel_subtotal: totals.labor_travel_subtotal,
    sales_tax: totals.sales_tax,
    total: totals.total,
    internal_notes: internalNotes,
    risk_statement: riskStatement,
    notes: [internalNotes, riskStatement].filter(Boolean).join("\n\n")
  };
}

export { hasQuoteDraftEvidence };
'@ | Set-Content -Encoding utf8 $parserPath

Write-Host "  Wrote: $parserPath"

# -------------------------------------------------------------------------
# QuoteDraftButton.jsx -- now also gates on hasQuoteDraftEvidence
# -------------------------------------------------------------------------
@'
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { parseQuoteDraftOutput, hasQuoteDraftEvidence } from "./quoteDraftTextParser";

// Quote Draft Agent (Step 2) plugin.
//
// This is intentionally NOT an AI feature inside this app -- the Quote Draft
// Agent runs elsewhere, in Copilot Studio. This component just takes the
// text that agent prints, parses it locally, and copies the values into
// this quote's fields. No network calls, no Base44 AI, no LLM invocation.
//
// Required fields filled by this plugin:
//   1. Site ID              2. Quote Requester       3. Case Number
//   4. Valid Until (always today + 30 days)
//   5. Scope of Work Description
//   6. Number of FSTs Needed 7. Labor Hours on Site
//   8. Total Travel Hours    9. Miles Traveled
//
// Any TEXT field that cannot be found is filled with the literal placeholder
// "Requires Manual Input". NUMERIC fields cannot hold placeholder text, so
// those are left blank when missing and flagged explicitly in the preview.
//
// Only text that shows real evidence of pricing (dollar amounts, a
// Materials Total, tax codes, etc.) is accepted -- pure Step 1 (Quote
// Request Agent) output, even though it shares many field labels, is
// rejected with guidance to run it through the Step 2 agent first.

const QUOTE_DRAFT_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_6ccb541a-f0ac-e794-bff9-c901fe959682&source=embedded-builder";

const MANUAL_INPUT_PLACEHOLDER = "Requires Manual Input";

function toFormUpdates(parsed) {
  const updates = {
    site_id: parsed.site_id || MANUAL_INPUT_PLACEHOLDER,
    quote_requester: parsed.quote_requester || MANUAL_INPUT_PLACEHOLDER,
    case_number: parsed.case_number || MANUAL_INPUT_PLACEHOLDER,
    valid_until: parsed.valid_until,
    scope_of_work: parsed.scope_of_work || MANUAL_INPUT_PLACEHOLDER,
    fst_count: parsed.fst_count || undefined,
    labor_hours: parsed.labor_hours || undefined,
    labor_rate: parsed.labor_rate || undefined,
    travel_hours: parsed.travel_hours || undefined,
    travel_rate: parsed.travel_rate || undefined,
    miles_traveled: parsed.miles_traveled || undefined,
    mileage_rate: parsed.mileage_rate || undefined,
    labor_mode: parsed.labor_mode || undefined,
    notes: parsed.notes || undefined
  };

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    updates.items = parsed.items.map((item) => ({
      product_id: item.product_id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: "each",
      total: item.total,
      taxable: item.taxable,
      tax_code: item.tax_code
    }));
  }

  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  return updates;
}

function getMissingRequiredFields(parsed) {
  const missing = [];
  if (!parsed.site_id) missing.push("Site ID");
  if (!parsed.quote_requester) missing.push("Quote Requester");
  if (!parsed.case_number) missing.push("Case Number");
  if (!parsed.scope_of_work) missing.push("Scope of Work Description");
  if (!parsed.fst_count) missing.push("Number of FSTs Needed");
  if (!parsed.labor_hours) missing.push("Number of Labor Hours on Site");
  if (!parsed.travel_hours) missing.push("Total Travel Hours (combined)");
  if (!parsed.miles_traveled) missing.push("Miles Traveled (combined)");
  return missing;
}

export default function QuoteDraftButton({ quote, products, onApply }) {
  const [open, setOpen] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [notStep2Warning, setNotStep2Warning] = useState(false);

  const closeDialog = () => {
    setOpen(false);
    setRawOutput("");
    setPreview(null);
    setError(null);
    setNotStep2Warning(false);
  };

  const handlePreview = () => {
    setError(null);
    setNotStep2Warning(false);
    try {
      if (!hasQuoteDraftEvidence(rawOutput)) {
        setNotStep2Warning(true);
        setPreview(null);
        return;
      }
      const parsed = parseQuoteDraftOutput(rawOutput);
      setPreview(parsed);
    } catch (err) {
      setError(err.message || "Could not parse the pasted output.");
      setPreview(null);
    }
  };

  const handleApply = () => {
    if (!preview) return;
    const updates = toFormUpdates(preview);
    onApply?.(updates);
    const missing = getMissingRequiredFields(preview);
    if (missing.length > 0) {
      toast.warning(
        "Applied with " + missing.length + " field(s) needing manual input: " + missing.join(", ")
      );
    } else {
      toast.success("Quote Draft Agent output applied. Review all fields before saving.");
    }
    closeDialog();
  };

  const missingFields = preview ? getMissingRequiredFields(preview) : [];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Quote Draft Agent
      </Button>

      <Dialog open={open} onOpenChange={(next) => (!next ? closeDialog() : setOpen(next))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Quote Draft Agent (Step 2)</DialogTitle>
            <DialogDescription>
              Paste the full output printed by the Quote Draft Agent (Step 2) below. This is parsed
              entirely in your browser and copied into this quote's fields, like pasting each value
              by hand. No data is sent to Base44, or any other service, to do this.
            </DialogDescription>
          </DialogHeader>

          <a
            href={QUOTE_DRAFT_AGENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 hover:underline -mt-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open the Quote Draft Agent (Step 2) chat to generate this output
          </a>

          {!preview ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Paste Quote Draft Agent Output
              </label>
              <Textarea
                value={rawOutput}
                onChange={(event) => setRawOutput(event.target.value)}
                placeholder="Paste the QUOTE BUILD PACKAGE output from the Quote Draft Agent (Step 2) here..."
                rows={14}
              />
              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </p>
              )}
              {notStep2Warning && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    This does not look like Quote Draft Agent (Step 2) output.
                  </p>
                  <p>
                    No pricing, tax codes, or totals were found. This usually means the pasted text is
                    from the Quote Request Agent (Step 1) instead. Paste your Step 1 output into the
                    Step 2 agent (link above) first, then paste its output here.
                  </p>
                  <p className="font-medium">What was received (first 500 characters):</p>
                  <pre className="bg-white border border-amber-200 rounded p-2 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {rawOutput.slice(0, 500) || "(nothing was pasted)"}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto text-sm">
              {missingFields.length > 0 && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="font-medium flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    {missingFields.length} required field(s) need manual input:
                  </p>
                  <ul className="list-disc list-inside mt-1">
                    {missingFields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-semibold">Site ID:</span> {preview.site_id || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Quote Requester:</span> {preview.quote_requester || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Case Number:</span> {preview.case_number || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Valid Until:</span> {preview.valid_until} (today + 30 days)</div>
                <div><span className="font-semibold">FSTs Needed:</span> {preview.fst_count || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Labor Hours:</span> {preview.labor_hours || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Travel Hours:</span> {preview.travel_hours || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Miles Traveled:</span> {preview.miles_traveled || MANUAL_INPUT_PLACEHOLDER}</div>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Scope of Work</p>
                <p className="text-slate-600 whitespace-pre-wrap">{preview.scope_of_work || MANUAL_INPUT_PLACEHOLDER}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Quote Items ({preview.items.length})</p>
                <ul className="list-disc list-inside text-slate-600">
                  {preview.items.map((item, index) => (
                    <li key={index}>
                      {item.quantity} x {item.name} -- ${item.unit_price} ({item.tax_code || "no tax code"})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            {!preview ? (
              <Button type="button" onClick={handlePreview}>
                <Sparkles className="w-4 h-4 mr-2" />
                Parse Output
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setPreview(null)}>Back</Button>
                <Button type="button" onClick={handleApply}>
                  <Check className="w-4 h-4 mr-2" />
                  Apply to Quote
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
'@ | Set-Content -Encoding utf8 $buttonPath

Write-Host "  Wrote: $buttonPath"
Write-Host ""
Write-Host "=== Done ==="
Write-Host "Restart your dev server (Ctrl+C, then npm.cmd run dev) and hard-refresh (Ctrl+Shift+R)."
