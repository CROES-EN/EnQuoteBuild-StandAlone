$ErrorActionPreference = "Stop"

$path = ".\src\features\quoteDraftAgent\QuoteDraftButton.jsx"
if (-not (Test-Path $path)) {
  Write-Error "Could not find $path. Run this from your EnQuote project root."
  exit 1
}

Write-Host "Adding a link to the Quote Draft Agent (Step 2) Copilot Studio chat inside the dialog."
Write-Host ""

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

const QUOTE_DRAFT_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_6ccb541a-f0ac-e794-bff9-c901fe959682&source=embedded-builder";

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

  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  return updates;
}

// Returns true if the parse found essentially nothing useful. Used to
// surface a clear warning instead of silently showing an "empty success"
// preview, which is confusing.
function isEmptyParse(parsed) {
  const hasHeaderData = Boolean(
    parsed.site_id || parsed.case_number || parsed.scope_of_work
  );
  const hasItems = Array.isArray(parsed.items) && parsed.items.length > 0;
  const hasLaborTravel = Boolean(
    parsed.fst_count || parsed.labor_hours || parsed.travel_hours || parsed.miles_traveled
  );
  return !hasHeaderData && !hasItems && !hasLaborTravel;
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
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-semibold">Site ID:</span> {preview.site_id || "(not found)"}</div>
                <div><span className="font-semibold">Case Number:</span> {preview.case_number || "(not found)"}</div>
                <div><span className="font-semibold">Valid Until:</span> {preview.valid_until || "(not found)"}</div>
                <div><span className="font-semibold">FSTs Needed:</span> {preview.fst_count || "(not found)"}</div>
                <div><span className="font-semibold">Labor Hours:</span> {preview.labor_hours || "(not found)"}</div>
                <div><span className="font-semibold">Travel Hours:</span> {preview.travel_hours || "(not found)"}</div>
                <div><span className="font-semibold">Miles Traveled:</span> {preview.miles_traveled || "(not found)"}</div>
                <div><span className="font-semibold">Estimated Total:</span> {preview.total ? "$" + preview.total : "(not found)"}</div>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Scope of Work</p>
                <p className="text-slate-600 whitespace-pre-wrap">{preview.scope_of_work || "(not found)"}</p>
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
'@ | Set-Content -Encoding utf8 $path

Write-Host "Patched: $path"
Write-Host ""
Write-Host "=== Done ==="
Write-Host "Restart your dev server (Ctrl+C, then npm.cmd run dev) and hard-refresh (Ctrl+Shift+R)."
Write-Host "Open the Quote Draft Agent button -- you should now see a link right under the"
Write-Host "description that opens the Step 2 Copilot Studio chat in a new tab."
