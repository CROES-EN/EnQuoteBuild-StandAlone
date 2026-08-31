$ErrorActionPreference = "Stop"
Write-Host "=== Implementing Quote Draft Agent (Step 2) as a paste-and-fill plugin ==="
Write-Host ""

# -------------------------------------------------------------------------
# STEP 1: Remove orphaned / superseded files so nothing conflicts with the
# plugin model. These either import a broken path or still call Base44 AI.
# -------------------------------------------------------------------------
Write-Host "Step 1: Removing orphaned and superseded files..."

$filesToRemove = @(
  ".\src\features\QuoteDraftButton.jsx",        # broken duplicate, imports non-existent ../../lib/base44
  ".\src\features\QuoteDraftModal.jsx",          # broken duplicate
  ".\src\features\quoteDraftService.js",         # broken duplicate
  ".\src\features\quoteDraftMapper.js",          # broken duplicate
  ".\src\features\quoteDraftAgent\QuoteDraftModal.jsx",   # superseded: called base44 InvokeLLM
  ".\src\features\quoteDraftAgent\quoteDraftService.js"   # superseded: called base44 InvokeLLM
)

foreach ($file in $filesToRemove) {
  if (Test-Path $file) {
    Remove-Item $file -Force
    Write-Host "  Removed: $file"
  } else {
    Write-Host "  Already gone: $file"
  }
}

Write-Host ""
Write-Host "Step 2: Writing the plugin (parser + button, zero API calls)..."

New-Item -ItemType Directory -Force -Path ".\src\features\quoteDraftAgent" | Out-Null

# -------------------------------------------------------------------------
# quoteDraftTextParser.js — pure text parsing, no network calls whatsoever.
# -------------------------------------------------------------------------
@'
// quoteDraftTextParser.js
//
// The Quote Draft Agent (Step 2) is a Copilot Studio agent that runs
// OUTSIDE this app. A person pastes its printed "QUOTE BUILD PACKAGE"
// output into this app, and this file parses that plain text into a
// structured object that maps 1:1 onto the Create/Edit Quote form fields.
//
// This is the equivalent of copy/pasting each value by hand -- just
// automated. There is no API call, no LLM invocation, and no dependency
// on Base44 (or any other backend) in this file.

const MATERIAL_SECTION_NAMES = [
  "Trunk Cable Repair Materials",
  "Electrical Materials",
  "Critter Guard Materials",
  "Communications Materials",
  "Battery Materials",
  "Monitoring Materials",
  "Weatherproofing Materials"
];

function cleanLine(line) {
  return line
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .trim();
}

function toLines(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function findHeadingIndex(lines, startIdx, headingCandidates) {
  for (let i = startIdx; i < lines.length; i++) {
    const cleaned = cleanLine(lines[i]).toLowerCase();
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

function parseHeaderFields(lines) {
  const fields = {};
  const patterns = {
    site_id: /^site id:\s*(.+)$/i,
    case_number: /^case number:\s*(.+)$/i,
    customer: /^customer:\s*(.+)$/i,
    site_address: /^site address:\s*(.+)$/i,
    service_type: /^service type:\s*(.+)$/i,
    valid_until_raw: /^valid until:\s*(.+)$/i,
    technician_name: /^technician name:\s*(.+)$/i
  };
  for (const line of lines) {
    const cleaned = cleanLine(line);
    for (const [key, re] of Object.entries(patterns)) {
      const match = cleaned.match(re);
      if (match) fields[key] = match[1].trim();
    }
  }
  return fields;
}

function resolveValidUntil(rawValue) {
  if (!rawValue) return null;
  const daysMatch = rawValue.match(/(\d+)\s*days?/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(rawValue);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseScopeOfWork(lines) {
  const { text } = sectionSlice(lines, ["Scope of Work"], ["Labor & Travel", "Labor and Travel"]);
  return text.map(cleanLine).join(" ").trim();
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

  const filtered = sectionLines
    .map(cleanLine)
    .filter((l) => l && !/^(description|quantity|rate|total)$/i.test(l));

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
  const assumptionsText = assumptionBlock.map(cleanLine).join(" ");

  const technicianMatch = assumptionsText.match(/(\d+)\s*technician/i);
  const laborHoursMatch = assumptionsText.match(/total labor hours:\s*([\d.]+)/i);
  const laborRateMatch = assumptionsText.match(/labor rate assumed at\s*\$?([\d.]+)/i);

  const laborTable = parseFourColumnTable(
    sectionSlice(lines, ["Labor Table"], ["Travel Table"]).text
  );
  const travelTable = parseFourColumnTable(
    sectionSlice(lines, ["Travel Table"], ["Labor & Travel Subtotal", "Materials"]).text
  );

  const labor = laborTable.map((row) => {
    const qty = parseQuantity(row.quantity);
    return {
      description: row.description,
      hours: qty.value,
      rate: parseCurrency(row.rate),
      total: parseCurrency(row.total)
    };
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

  const totalLaborHours =
    laborHoursMatch != null
      ? parseFloat(laborHoursMatch[1])
      : labor.reduce((sum, l) => sum + (l.hours || 0), 0);

  const totalTravelHours = travel
    .filter((t) => t.unit === "hours")
    .reduce((sum, t) => sum + (t.quantity || 0), 0);

  const totalMiles = travel
    .filter((t) => t.unit === "miles")
    .reduce((sum, t) => sum + (t.quantity || 0), 0);

  return {
    fst_count: technicianMatch ? parseInt(technicianMatch[1], 10) : (labor.length ? 1 : 0),
    labor_hours: totalLaborHours,
    labor_rate: laborRateMatch ? parseFloat(laborRateMatch[1]) : (labor[0]?.rate || 0),
    travel_hours: totalTravelHours,
    travel_rate: travel.find((t) => t.unit === "hours")?.rate || 65,
    miles_traveled: totalMiles,
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

  for (const rawLine of materialsBlock) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const isKnownSection = MATERIAL_SECTION_NAMES.some(
      (name) => name.toLowerCase() === line.toLowerCase()
    );
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

  const filtered = sectionLines.filter(
    (l) => !/^(item|qty|unit price|tax code)$/i.test(l)
  );
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
  const joined = lines.map(cleanLine).join("\n");
  const materialsTotalMatch = joined.match(/Materials Total\s*\n?\$?([\d,.]+)/i);
  const laborTravelSubtotalMatch = joined.match(/Labor & Travel Subtotal\s*\n?\$?([\d,.]+)/i);
  const salesTaxMatch = joined.match(/Estimated Sales Tax:\s*\$?([\d,.]+)/i);
  const grandTotalMatch = joined.match(/Estimated Quote Total\s*\n?\$?([\d,.]+)/i);

  return {
    materials_total: materialsTotalMatch ? parseFloat(materialsTotalMatch[1].replace(/,/g, "")) : null,
    labor_travel_subtotal: laborTravelSubtotalMatch
      ? parseFloat(laborTravelSubtotalMatch[1].replace(/,/g, ""))
      : null,
    sales_tax: salesTaxMatch ? parseFloat(salesTaxMatch[1].replace(/,/g, "")) : null,
    total: grandTotalMatch ? parseFloat(grandTotalMatch[1].replace(/,/g, "")) : null
  };
}

function parseNamedSection(lines, startHeadings, endHeadings) {
  const { text } = sectionSlice(lines, startHeadings, endHeadings);
  return text.map(cleanLine).join("\n").trim();
}

export function parseQuoteDraftOutput(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Paste the Quote Draft Agent output before applying it.");
  }

  const lines = toLines(rawText);

  const header = parseHeaderFields(lines);
  const scopeOfWork = parseScopeOfWork(lines);
  const laborTravel = parseLaborAndTravel(lines);
  const materials = parseMaterials(lines);
  const totals = parseTotals(lines);
  const internalNotes = parseNamedSection(lines, ["Internal Notes"], ["Risk Adjustment Statement", "END OF OUTPUT"]);
  const riskStatement = parseNamedSection(lines, ["Risk Adjustment Statement"], ["END OF OUTPUT"]);

  return {
    site_id: header.site_id || "",
    case_number: header.case_number || "",
    customer: header.customer || "",
    site_address: header.site_address || "",
    service_type: header.service_type || "",
    technician_name: header.technician_name || "",
    valid_until: resolveValidUntil(header.valid_until_raw),
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
'@ | Set-Content -Encoding utf8 .\src\features\quoteDraftAgent\quoteDraftTextParser.js

Write-Host "  Wrote: src/features/quoteDraftAgent/quoteDraftTextParser.js"

# -------------------------------------------------------------------------
# QuoteDraftButton.jsx — paste box + preview + apply. No API calls.
# Signature matches how QuoteForm.jsx already invokes it:
#   <QuoteDraftButton quote={...} products={...} onApply={(draftData) => {...}} />
# -------------------------------------------------------------------------
@'
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { parseQuoteDraftOutput } from "./quoteDraftTextParser";

// Quote Draft Agent (Step 2) plugin.
//
// This is intentionally NOT an AI feature inside this app -- the Quote Draft
// Agent runs elsewhere (Copilot Studio). This component just takes the text
// that agent prints, parses it locally, and copies the values into this
// quote's form fields. No network calls, no Base44 AI, no LLM invocation.
//
// `onApply(draftData)` is called with a single object whose keys line up
// with QuoteForm's formData shape, matching how QuoteForm.jsx already wires
// this component: onApply={(draftData) => setFormData(prev => ({ ...prev, ...draftData }))}

function toFormUpdates(parsed) {
  const updates = {
    site_id: parsed.site_id || undefined,
    case_number: parsed.case_number || undefined,
    valid_until: parsed.valid_until || undefined,
    scope_of_work: parsed.scope_of_work || undefined,
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

  // Strip undefined keys so we only overwrite fields that were actually parsed
  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  return updates;
}

export default function QuoteDraftButton({ quote, products, onApply }) {
  const [open, setOpen] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  const closeDialog = () => {
    setOpen(false);
    setRawOutput("");
    setPreview(null);
    setError(null);
  };

  const handlePreview = () => {
    setError(null);
    try {
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
    toast.success("Quote Draft Agent output applied. Review all fields before saving.");
    closeDialog();
  };

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
              entirely in your browser and copied into this quote's fields -- like pasting each value
              by hand. No data is sent to Base44, or any other service, to do this.
            </DialogDescription>
          </DialogHeader>

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
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-semibold">Site ID:</span> {preview.site_id || "—"}</div>
                <div><span className="font-semibold">Case Number:</span> {preview.case_number || "—"}</div>
                <div><span className="font-semibold">Valid Until:</span> {preview.valid_until || "—"}</div>
                <div><span className="font-semibold">FSTs Needed:</span> {preview.fst_count || "—"}</div>
                <div><span className="font-semibold">Labor Hours:</span> {preview.labor_hours || "—"}</div>
                <div><span className="font-semibold">Travel Hours:</span> {preview.travel_hours || "—"}</div>
                <div><span className="font-semibold">Miles Traveled:</span> {preview.miles_traveled || "—"}</div>
                <div><span className="font-semibold">Estimated Total:</span> {preview.total ? `$${preview.total}` : "—"}</div>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Scope of Work</p>
                <p className="text-slate-600 whitespace-pre-wrap">{preview.scope_of_work || "—"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Quote Items ({preview.items.length})</p>
                <ul className="list-disc list-inside text-slate-600">
                  {preview.items.map((item, index) => (
                    <li key={index}>
                      {item.quantity} x {item.name} — ${item.unit_price} ({item.tax_code || "no tax code"})
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
'@ | Set-Content -Encoding utf8 .\src\features\quoteDraftAgent\QuoteDraftButton.jsx

Write-Host "  Wrote: src/features/quoteDraftAgent/QuoteDraftButton.jsx"
Write-Host ""

# -------------------------------------------------------------------------
# STEP 3: Verify no remaining references to the removed/superseded files.
# -------------------------------------------------------------------------
Write-Host "Step 3: Checking for stale references..."
$staleRefs = Select-String -Path .\src\**\*.jsx,.\src\**\*.js -Pattern "quoteDraftService|QuoteDraftModal" -ErrorAction SilentlyContinue
if ($staleRefs) {
  Write-Host "  WARNING: found references to removed files:" -ForegroundColor Yellow
  $staleRefs | ForEach-Object { Write-Host "    $($_.Path):$($_.LineNumber)" -ForegroundColor Yellow }
} else {
  Write-Host "  Clean -- no stale references found."
}

Write-Host ""
Write-Host "=== Done ==="
Write-Host "QuoteForm.jsx already imports QuoteDraftButton from '@/features/quoteDraftAgent/QuoteDraftButton'"
Write-Host "and is shared by both CreateQuote.jsx and EditQuote.jsx, so no further wiring is needed."
Write-Host ""
Write-Host "Restart your dev server to pick up these changes."
