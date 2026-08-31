import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { generateQuoteDraft } from "./quoteDraftService";
import { mapDraftToQuoteUpdate } from "./quoteDraftMapper";

const sections = [
  ["Scope of Work", "scopeOfWork"],
  ["Homeowner Summary", "homeownerSummary"],
  ["Internal Notes", "internalNotes"],
  ["Risk Adjustment Statement", "riskStatement"]
];

export default function QuoteDraftModal({ quote, open, onOpenChange, onApply }) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) setDraft(null);
    onOpenChange(nextOpen);
  };

  const generate = async () => {
    setLoading(true);
    try {
      setDraft(await generateQuoteDraft(quote));
    } catch (error) {
      toast.error(`Failed to generate quote draft: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!draft) return;
    onApply(mapDraftToQuoteUpdate(draft, quote), draft);
    handleOpenChange(false);
    toast.success("Quote draft applied. Review the fields before saving.");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-600" />Quote Draft Agent</DialogTitle>
          <DialogDescription>Generate a draft, review the proposed content, then apply it to this quote.</DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-slate-600">The agent will use the current quote record and return structured quote data.</p>
            <Button onClick={generate} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Generating..." : "Generate Draft"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {sections.map(([label, key]) => (
              <section key={key} className="rounded-lg border border-slate-200 p-3">
                <h3 className="mb-1 font-semibold text-slate-900">{label}</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{draft[key] || "No content provided."}</p>
              </section>
            ))}
            <section className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-1 font-semibold text-slate-900">Quote Details</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify({ materials: draft.materials || [], labor: draft.labor || [], travel: draft.travel || [], quoteSummary: draft.quoteSummary || {} }, null, 2)}</pre>
            </section>
          </div>
        )}
        <DialogFooter>
          {draft && <Button variant="outline" onClick={generate} disabled={loading}>{loading ? "Generating..." : "Regenerate"}</Button>}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          {draft && <Button onClick={apply}>Apply to Quote</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
