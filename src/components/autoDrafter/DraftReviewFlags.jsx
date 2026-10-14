// Review pieces shared by the Auto-Drafter draft page and the Quote Draft Agent dialog, so both
// show the same compatibility, dependency, conduit and Enphase data sheet checks for a draft.
import {AlertTriangle, BookOpen, ExternalLink, Info, ShieldAlert, ShieldCheck} from "lucide-react";
import {enphaseSource, enphaseSpecChecks, enphaseSpecSummary, findEnphaseProduct} from "@/features/quoteDraftAgent/enphaseKnowledgeBase";

/** Every review flag for a generated draft, in display order. */
export function draftReviewFlags(draft, requestText = "") {
  return [
    ...(draft?.compatibility_flags || []),
    ...(draft?.legacy_warnings || []).map((w) => ({ status: "review_required", ...w, reason: w.reason || w.message })),
    ...(draft?.dependency_advisories || []).map((a) => ({
      status: "review_required",
      triggerItem: a.triggerItem,
      reason: a.note || a.reason || "Advisory accessory suggestion -- review before finalizing."
    })),
    ...(draft?.material_size_flags || []).map((f) => ({
      status: "review_required",
      triggerItem: f.type === "size_mismatch" ? "Conduit Size" : "Conduit Material",
      reason: f.reason
    })),
    ...enphaseSpecChecks(draft?.items || [], requestText).map((check) => ({status: "spec_reference", ...check}))
  ];
}

export function CompatibilityFlagRow({ flag }) {
  const config = {
    blocked: { icon: ShieldAlert, className: "border-rose-200 bg-rose-50 text-rose-800" },
    review_required: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-800" },
    verified_compatible: { icon: ShieldCheck, className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    spec_reference: { icon: BookOpen, className: "border-sky-200 bg-sky-50 text-sky-800" }
  }[flag.status] || { icon: Info, className: "border-slate-200 bg-slate-50 text-slate-700" };
  const Icon = config.icon;

  return (
    <div data-flag-status={flag.status} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${config.className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">{flag.triggerItem}</p>
        <p>{flag.reason}</p>
        {flag.source?.url && (
          <a href={flag.source.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
            Source: {flag.source.title}{flag.source.revision ? ` (${flag.source.revision})` : ""}<ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// Data sheet summary under Enphase line items (enphaseKnowledgeBase.js), with a link to the source.
export function EnphaseSpecLine({ item }) {
  const entry = item?.confidence === "low" ? null : findEnphaseProduct(item?.name, item?.sku);
  if (!entry) return null;
  const source = enphaseSource(entry);
  return (
    <p data-enphase-spec={entry.id} className="text-xs text-sky-700">
      {enphaseSpecSummary(entry)}
      {source && <a href={source.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">
        Data sheet<ExternalLink className="h-3 w-3" />
      </a>}
    </p>
  );
}
