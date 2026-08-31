import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { parseQuoteRequestOutput, hasQuoteRequestEvidence } from "./quoteRequestTextParser";
import { generateQuoteDraft } from "./draftEngine";

// Quote Draft Agent (Step 2) -- LOCAL, in-app replacement.
//
// The input to this dialog is the plain text printed by the Quote Request
// Agent (Step 1) -- the same text an FST posts in Salesforce. This
// component then does what the Step 2 Copilot Studio agent used to do
// manually: it matches requested products/services/materials against the
// real product catalog, assigns real prices and Avalara tax codes,
// computes FST labor hours and travel, and generates a scope-of-work
// summary -- entirely in the browser. No API calls, no Base44 AI, no LLM
// invocation of any kind.

const QUOTE_REQUEST_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_03e793b7-91a0-99a1-13a8-9cc6f331a45e&source=embedded-builder";

const MANUAL_INPUT_PLACEHOLDER = "Requires Manual Input";

function computeValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function toFormUpdates(draft) {
  const updates = {
    site_id: draft.site_id || MANUAL_INPUT_PLACEHOLDER,
    quote_requester: MANUAL_INPUT_PLACEHOLDER, // Step 1 output does not include a requester field
    case_number: draft.case_number || MANUAL_INPUT_PLACEHOLDER,
    valid_until: computeValidUntil(),
    scope_of_work: draft.scope_of_work || MANUAL_INPUT_PLACEHOLDER,
    fst_count: draft.fst_count || undefined,
    labor_hours: draft.labor_hours || undefined,
    labor_rate: draft.labor_rate || undefined,
    travel_hours: draft.travel_hours || undefined,
    travel_rate: draft.travel_rate || undefined,
    miles_traveled: draft.miles_traveled || undefined,
    mileage_rate: draft.mileage_rate || undefined,
    labor_mode: "hourly",
    notes: draft.notes || undefined
  };

  if (Array.isArray(draft.items) && draft.items.length > 0) {
    updates.items = draft.items;
  }

  Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
  return updates;
}

function getMissingRequiredFields(draft) {
  const missing = [];
  if (!draft.site_id) missing.push("Site ID");
  missing.push("Quote Requester"); // never provided by Step 1 output
  if (!draft.case_number) missing.push("Case Number");
  if (!draft.scope_of_work) missing.push("Scope of Work Description");
  if (!draft.fst_count) missing.push("Number of FSTs Needed");
  if (!draft.labor_hours) missing.push("Number of Labor Hours on Site");
  if (!draft.travel_hours) missing.push("Total Travel Hours (combined)");
  if (!draft.miles_traveled) missing.push("Miles Traveled (combined)");
  return missing;
}

export default function QuoteDraftButton({ quote, products, onApply }) {
  const [open, setOpen] = useState(false);
  const [rawOutput, setRawOutput] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [notStep1Warning, setNotStep1Warning] = useState(false);

  const closeDialog = () => {
    setOpen(false);
    setRawOutput("");
    setPreview(null);
    setError(null);
    setNotStep1Warning(false);
  };

  const handlePreview = () => {
    setError(null);
    setNotStep1Warning(false);
    try {
      if (!hasQuoteRequestEvidence(rawOutput)) {
        setNotStep1Warning(true);
        setPreview(null);
        return;
      }
      const parsedRequest = parseQuoteRequestOutput(rawOutput);
      const draft = generateQuoteDraft(parsedRequest);
      setPreview(draft);
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
    if (missing.length > 0 || preview.unmatched_count > 0) {
      const parts = [];
      if (missing.length > 0) parts.push(`${missing.length} field(s) need manual input: ${missing.join(", ")}`);
      if (preview.unmatched_count > 0) parts.push(`${preview.unmatched_count} item(s) used estimated placeholder pricing`);
      toast.warning(`Applied. ${parts.join(". ")}.`);
    } else {
      toast.success("Quote draft applied. Review all fields and pricing before saving.");
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
              Paste the output printed by the Quote Request Agent (Step 1) below. This is matched
              against the product catalog and priced entirely in your browser -- no data is sent to
              Base44, Copilot Studio, or any other service to do this.
            </DialogDescription>
          </DialogHeader>

          <a
            href={QUOTE_REQUEST_AGENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 hover:underline -mt-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open the Quote Request Agent (Step 1) chat to generate this output
          </a>

          {!preview ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Paste Quote Request Agent Output
              </label>
              <Textarea
                value={rawOutput}
                onChange={(event) => setRawOutput(event.target.value)}
                placeholder="Paste the Quote Request output from the Quote Request Agent (Step 1) here..."
                rows={14}
              />
              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </p>
              )}
              {notStep1Warning && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-4 h-4" />
                    This does not look like Quote Request Agent (Step 1) output.
                  </p>
                  <p>
                    Expected fields like "Site ID:", "Case Number:", or "Recommended Scope of Work"
                    were not found. Paste the text printed by the Quote Request Agent (Step 1) chat,
                    which is what FSTs post in Salesforce.
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
              {(missingFields.length > 0 || preview.unmatched_count > 0) && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  {missingFields.length > 0 && (
                    <div>
                      <p className="font-medium flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        {missingFields.length} required field(s) need manual input:
                      </p>
                      <ul className="list-disc list-inside">
                        {missingFields.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.unmatched_count > 0 && (
                    <div>
                      <p className="font-medium flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        {preview.unmatched_count} item(s) used estimated placeholder pricing -- verify before saving:
                      </p>
                      <ul className="list-disc list-inside">
                        {preview.unmatched_items.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-semibold">Site ID:</span> {preview.site_id || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Case Number:</span> {preview.case_number || MANUAL_INPUT_PLACEHOLDER}</div>
                <div><span className="font-semibold">Valid Until:</span> {computeValidUntil()} (today + 30 days)</div>
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

