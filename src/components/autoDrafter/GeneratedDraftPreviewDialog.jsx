import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert, ShieldCheck, Info } from "lucide-react";

/**
 * GeneratedDraftPreviewDialog - read-only preview of a single Auto-Drafter
 * case's generateQuoteDraft() output (draftEngine.js), reached via the new
 * "Generate Draft" button on AutoDrafterCaseTile.jsx.
 *
 * Deliberately READ-ONLY and does not save anything -- this is purely a
 * "here's what the Quote Draft Agent would produce from this case's data"
 * preview, matching this slice's intentionally limited scope (see
 * parseQuoteRequestCase.js's own header comment). Turning this into an actual
 * saved Quote record is a separate, future step.
 */
function ConfidenceBadge({ confidence }) {
  const styles = {
    high: "bg-emerald-100 text-emerald-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-rose-100 text-rose-700"
  };
  return (
    <Badge variant="secondary" className={styles[confidence] || "bg-slate-100 text-slate-700"}>
      {confidence || "unknown"}
    </Badge>
  );
}

function CompatibilityFlagRow({ flag }) {
  const config = {
    blocked: { icon: ShieldAlert, className: "border-rose-200 bg-rose-50 text-rose-800" },
    review_required: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-800" },
    verified_compatible: { icon: ShieldCheck, className: "border-emerald-200 bg-emerald-50 text-emerald-800" }
  }[flag.status] || { icon: Info, className: "border-slate-200 bg-slate-50 text-slate-700" };
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${config.className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">{flag.triggerItem}</p>
        <p>{flag.reason}</p>
      </div>
    </div>
  );
}

export default function GeneratedDraftPreviewDialog({ open, onOpenChange, draft, parseWarnings, caseLabel }) {
  if (!draft) return null;

  const allFlags = [
    ...(draft.compatibility_flags || []),
    ...(draft.legacy_warnings || []).map((w) => ({ status: "review_required", ...w })),
    ...(draft.dependency_advisories || []).map((a) => ({
      status: "review_required",
      triggerItem: a.triggerItem,
      reason: a.note || a.reason || "Advisory accessory suggestion -- review before finalizing."
    }))
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generated Draft Preview{caseLabel ? ` — ${caseLabel}` : ""}</DialogTitle>
          <DialogDescription>
            This is a preview only, generated locally from this case's data. Nothing has been saved yet.
          </DialogDescription>
        </DialogHeader>

        {parseWarnings && parseWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Some fields could not be parsed:</p>
            <ul className="mt-1 list-disc pl-5">
              {parseWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4 text-sm">
          <div>
            <h4 className="mb-1 font-semibold text-foreground">Site</h4>
            <p className="text-muted-foreground">
              {draft.site_id ? `Site ${draft.site_id}` : "Site ID not found"}
              {draft.case_number ? ` · Case #${draft.case_number}` : ""}
            </p>
            <p className="text-muted-foreground">{draft.customer}</p>
            <p className="text-muted-foreground">{draft.site_address}</p>
          </div>

          {draft.scope_of_work && (
            <div>
              <h4 className="mb-1 font-semibold text-foreground">Scope of Work</h4>
              <p className="whitespace-pre-wrap text-muted-foreground">{draft.scope_of_work}</p>
            </div>
          )}

          <div>
            <h4 className="mb-1 font-semibold text-foreground">Labor & Travel</h4>
            <p className="text-muted-foreground">
              {draft.fst_count} technician(s) · {draft.labor_hours} onsite hour(s)
              {draft.travel_hours ? ` · ${draft.travel_hours} travel hour(s)` : ""}
              {draft.miles_traveled ? ` · ${draft.miles_traveled} mile(s)` : ""}
            </p>
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-foreground">Line Items ({draft.items?.length || 0})</h4>
            <div className="space-y-2">
              {(draft.items || []).map((item, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} {item.unit} @ ${item.unit_price?.toFixed(2)}
                    </p>
                    {item.confidence_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{item.confidence_reason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ConfidenceBadge confidence={item.confidence} />
                    <span className="text-sm font-semibold text-foreground">${item.total?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              {(!draft.items || draft.items.length === 0) && (
                <p className="italic text-muted-foreground">No line items were generated from this case.</p>
              )}
            </div>
          </div>

          {allFlags.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold text-foreground">Compatibility & Dependency Flags</h4>
              <div className="space-y-2">
                {allFlags.map((flag, idx) => (
                  <CompatibilityFlagRow key={idx} flag={flag} />
                ))}
              </div>
            </div>
          )}

          {draft.notes && (
            <div>
              <h4 className="mb-1 font-semibold text-foreground">Notes</h4>
              <p className="whitespace-pre-wrap text-muted-foreground">{draft.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
