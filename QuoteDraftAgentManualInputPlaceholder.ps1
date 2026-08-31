$ErrorActionPreference = "Stop"

Write-Host "=== Adding 'Requires Manual Input' placeholder for missing text fields ==="
Write-Host ""
Write-Host "Text fields (Site ID, Quote Requester, Case Number, Scope of Work) will be"
Write-Host "filled with the literal text 'Requires Manual Input' when not found in the"
Write-Host "pasted Quote Draft Agent (Step 2) output."
Write-Host ""
Write-Host "Numeric fields (FSTs Needed, Labor Hours, Travel Hours, Miles Traveled) CANNOT"
Write-Host "hold placeholder text -- HTML number inputs silently reject non-numeric values."
Write-Host "These are left blank when missing, and the preview dialog clearly flags each"
Write-Host "one as 'Requires Manual Input' so nothing is missed before applying."
Write-Host ""

$buttonPath = ".\src\features\quoteDraftAgent\QuoteDraftButton.jsx"
if (-not (Test-Path $buttonPath)) {
  Write-Error "Could not find $buttonPath. Run this from your EnQuote project root."
  exit 1
}

@'
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { parseQuoteDraftOutput } from "./quoteDraftTextParser";

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
// "Requires Manual Input" so it is impossible to miss. NUMERIC fields (FSTs,
// Labor Hours, Travel Hours, Miles Traveled) cannot hold placeholder text --
// HTML number inputs reject non-numeric values -- so those are left blank
// when missing, and the preview below explicitly flags them instead.

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

// Returns true if the parse found essentially nothing useful. Used to
// surface a clear warning instead of silently showing an "empty success"
// preview, which is confusing.
function isEmptyParse(parsed) {
  const hasHeaderData = Boolean(
    parsed.site_id || parsed.case_number || parsed.scope_of_work || parsed.quote_requester
  );
  const hasItems = Array.isArray(parsed.items) && parsed.items.length > 0;
  const hasLaborTravel = Boolean(
    parsed.fst_count || parsed.labor_hours || parsed.travel_hours || parsed.miles_traveled
  );
  return !hasHeaderData && !hasItems && !hasLaborTravel;
}

// Builds a list of the 9 required fields that could not be found, for
// display in the preview so nothing is silently missed.
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
  const [emptyParseWarning, setEmptyParseWarning] = useState(false);

  const closeDialog = () => {
    setOpen(false);
    setRawOutput("");
    setPreview(null);
    setError(null);
    setEmptyParseWarning(false);
  };

  const handlePreview = () => {
    setError(null);
    setEmptyParseWarning(false);
    try {
      const parsed = parseQuoteDraftOutput(rawOutput);
      if (isEmptyParse(parsed)) {
        setEmptyParseWarning(true);
        setPreview(null);
        return;
      }
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
              {emptyParseWarning && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    No recognizable fields were found in the pasted text.
                  </p>
                  <p>
                    This usually means the pasted text is from the Quote Request Agent (Step 1) instead
                    of the Quote Draft Agent (Step 2), or the format was altered when copying. Paste your
                    Step 1 output into the Step 2 agent (link above) first, then paste its output here.
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

Write-Host "Patched: $buttonPath"
Write-Host ""
Write-Host "=== Done ==="
Write-Host "Restart your dev server (Ctrl+C, then npm.cmd run dev) and hard-refresh (Ctrl+Shift+R)."
