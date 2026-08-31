import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, FileText, MessageSquare, Wrench, TrendingUp, Pencil, ClipboardList } from "lucide-react";

const formatDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
const formatCurrency = (v) => `$${(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function StatusPill({ status }) {
  const map = {
    rejected: "bg-red-100 text-red-700 border-red-200",
    approved: "bg-green-100 text-green-700 border-green-200",
    submitted: "bg-blue-100 text-blue-700 border-blue-200",
    quote_sent_to_ho: "bg-purple-100 text-purple-700 border-purple-200",
    ho_approved_invoice_required: "bg-emerald-100 text-emerald-700 border-emerald-200",
    invoiced: "bg-teal-100 text-teal-700 border-teal-200",
    invoice_paid: "bg-green-200 text-green-800 border-green-300",
    scheduled: "bg-teal-200 text-teal-800 border-teal-300",
    draft_without_internal: "bg-slate-100 text-slate-600 border-slate-200",
    draft_without_fst: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const label = status?.replace(/_/g, " ") || "unknown";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {label}
    </span>
  );
}

export default function SiteRejectionProgressPanel({ siteId, allReviews = [], onReviewQuote }) {
  // Fetch ALL quotes for this site (all versions, all statuses)
  const { data: siteQuotes = [], isLoading } = useQuery({
    queryKey: ["site-all-quotes", siteId],
    queryFn: async () => (await getQuotes()).filter(quote => quote.site_id === siteId).sort((a, b) => String(a.created_date || "").localeCompare(String(b.created_date || ""))).slice(0, 200),
    enabled: !!siteId,
  });

  // Index reviews by quote_id for quick lookup
  const reviewByQuoteId = {};
  allReviews.forEach(r => { if (!reviewByQuoteId[r.quote_id]) reviewByQuoteId[r.quote_id] = r; });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Sort by version number / created date ascending — earliest first
  const sorted = [...siteQuotes].sort((a, b) => {
    const va = a.version_number || 1;
    const vb = b.version_number || 1;
    if (va !== vb) return va - vb;
    return new Date(a.created_date) - new Date(b.created_date);
  });

  // Find all rejection events across all versions
  const allRejections = sorted.flatMap(q => {
    const rejEntries = (q.status_history || []).filter(h => h.status === "rejected");
    return rejEntries.map(r => ({ quote: q, entry: r }));
  });

  // Latest status across all versions — find the most progressed version (ignoring on_hold/boneyard)
  const RESOLVED_STATUSES = ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"];
  const resolvedVersion = sorted.find(q => RESOLVED_STATUSES.includes(q.status));
  const latestQuote = sorted[sorted.length - 1];
  const currentStatus = resolvedVersion?.status || latestQuote?.status;
  const isResolved = RESOLVED_STATUSES.includes(currentStatus);

  // Build a flat, chronologically-ordered timeline across all quote versions.
  // Each event gets a sortable date so we can order everything correctly.
  const rawEvents = [];

  sorted.forEach((q, qIdx) => {
    const history = q.status_history || [];
    // Reviews scoped strictly to this quote
    const reviews = allReviews.filter(r => r.quote_id === q.id);

    // Version marker — one per quote, anchored to submitted date or created date
    const submitEntry = history.find(h => h.status === "submitted");
    rawEvents.push({
      type: "version",
      label: `Quote Version ${q.version_number || qIdx + 1}`,
      quoteNumber: q.quote_number,
      total: q.total,
      date: submitEntry?.changed_at || q.created_date,
      scopeOfWork: q.scope_of_work,
      items: q.items || [],
      quoteObj: q, // carry full quote for review action
      _sortDate: new Date(submitEntry?.changed_at || q.created_date),
      _quoteIdx: qIdx,
    });

    // Every status change in this quote's history
    history.forEach(h => {
      const positiveStatuses = ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"];
      if (h.status === "submitted") return; // already captured as version marker

      if (h.status === "rejected") {
        rawEvents.push({
          type: "rejection",
          rejectedBy: h.changed_by,
          date: h.changed_at,
          reason: q.rejection_reason || h.reason,
          quoteNumber: q.quote_number,
          total: q.total,
          quoteId: q.id,
          _sortDate: new Date(h.changed_at || 0),
          _quoteIdx: qIdx,
        });
      } else if (positiveStatuses.includes(h.status)) {
        rawEvents.push({
          type: "progress",
          status: h.status,
          changedBy: h.changed_by,
          date: h.changed_at,
          _sortDate: new Date(h.changed_at || 0),
          _quoteIdx: qIdx,
        });
      }
    });

    // Follow-up log entries from status_history (entry_type === "follow_up")
    history.forEach(h => {
      if (h.entry_type === "follow_up") {
        rawEvents.push({
          type: "followup",
          note: h.reason,
          loggedBy: h.changed_by,
          date: h.changed_at,
          _sortDate: new Date(h.changed_at || 0),
          _quoteIdx: qIdx,
        });
      }
    });

    // Coaching reviews — placed once per quote (after rejections, before next version)
    // Use updated_date as sort anchor so they appear right after the rejection they address
    reviews.forEach(rev => {
      rawEvents.push({
        type: "coaching",
        reviewer: rev.reviewer_email,
        date: rev.completed_date || rev.updated_date,
        status: rev.review_status,
        coachingNotes: rev.coaching_notes,
        recommendedEdits: rev.recommended_edits,
        quoteNumber: q.quote_number,
        _sortDate: new Date(rev.updated_date || rev.created_date || 0),
        _quoteIdx: qIdx,
      });
    });
  });

  // Sort all events: first by quote version index, then by date within each version
  rawEvents.sort((a, b) => {
    if (a._quoteIdx !== b._quoteIdx) return a._quoteIdx - b._quoteIdx;
    // Within the same quote, version marker always comes first
    if (a.type === "version") return -1;
    if (b.type === "version") return 1;
    return a._sortDate - b._sortDate;
  });

  // De-duplicate: if there's only 1 quote version, skip the version marker (not useful)
  const timeline = sorted.length === 1
    ? rawEvents.filter(e => e.type !== "version")
    : rawEvents;

  const rejectionCount = allRejections.length;

  return (
    <div className="flex flex-col gap-5">
      {/* Site Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Site: {siteId}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {sorted.length} quote version{sorted.length !== 1 ? "s" : ""} · {rejectionCount} rejection{rejectionCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isResolved ? (
            <Badge className="bg-green-100 text-green-700 border border-green-200 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Progressed
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Still Rejected
            </Badge>
          )}
          <StatusPill status={currentStatus} />
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
        <div className="space-y-4 pl-10">
          {timeline.map((event, i) => {
            if (event.type === "version") {
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-slate-400 border-2 border-white flex items-center justify-center">
                    <FileText className="w-2 h-2 text-white" />
                  </div>
                  <Card className="border-slate-300 bg-slate-50">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{event.label}</p>
                          <p className="text-sm font-semibold text-slate-800">Quote #{event.quoteNumber || "—"} · {formatCurrency(event.total)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-slate-400">{formatDate(event.date)}</p>
                          {onReviewQuote && event.quoteObj && !isResolved && event.quoteObj.status === "rejected" && reviewByQuoteId[event.quoteObj.id]?.review_status !== "completed" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={() => onReviewQuote(event.quoteObj)}>
                              <Pencil className="w-3 h-3" /> Write Review
                            </Button>
                          )}
                        </div>
                      </div>
                      {event.scopeOfWork && (
                        <p className="text-xs text-slate-600 mt-2 bg-white rounded px-2 py-1 border border-slate-200 line-clamp-3">
                          <span className="font-medium text-slate-500">Scope: </span>{event.scopeOfWork}
                        </p>
                      )}
                      {event.items?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-slate-500 font-medium mb-1">Line Items:</p>
                          <div className="flex flex-wrap gap-1">
                            {event.items.map((item, ii) => (
                              <span key={ii} className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">
                                {item.name} × {item.quantity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            }

            if (event.type === "rejection") {
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-red-500 border-2 border-white flex items-center justify-center">
                    <AlertCircle className="w-2 h-2 text-white" />
                  </div>
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p className="text-xs font-bold text-red-600 uppercase tracking-wide flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Rejected
                        </p>
                        <p className="text-xs text-slate-400">{formatDate(event.date)} · by {event.rejectedBy || "ajennings"}</p>
                      </div>
                      <p className="text-sm text-slate-800 bg-white border border-red-200 rounded px-2 py-1.5 whitespace-pre-wrap">
                        {event.reason || "No reason provided."}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              );
            }

            if (event.type === "followup") {
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white flex items-center justify-center">
                    <ClipboardList className="w-2 h-2 text-white" />
                  </div>
                  <Card className="border-indigo-200 bg-indigo-50">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide flex items-center gap-1">
                          <ClipboardList className="w-3 h-3" /> Follow-Up Log
                        </p>
                        <p className="text-xs text-slate-400">{formatDate(event.date)} · {event.loggedBy || "—"}</p>
                      </div>
                      {event.note && (
                        <p className="text-xs text-slate-700 bg-white border border-indigo-200 rounded px-2 py-1.5 whitespace-pre-wrap">{event.note}</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            }

            if (event.type === "coaching") {
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center">
                    <MessageSquare className="w-2 h-2 text-white" />
                  </div>
                  <Card className="border-blue-200 bg-blue-50">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p className="text-xs font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> Coaching Review
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge className={event.status === "completed" ? "bg-green-100 text-green-700 text-xs" : "bg-blue-100 text-blue-700 text-xs"}>
                            {event.status?.replace("_", " ") || "pending"}
                          </Badge>
                          <p className="text-xs text-slate-400">{formatDate(event.date)} · {event.reviewer}</p>
                        </div>
                      </div>
                      {event.coachingNotes && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500 font-medium mb-0.5">Coaching Notes:</p>
                          <p className="text-xs text-slate-700 bg-white border border-blue-200 rounded px-2 py-1.5 whitespace-pre-wrap">{event.coachingNotes}</p>
                        </div>
                      )}
                      {event.recommendedEdits && (
                        <div>
                          <p className="text-xs text-slate-500 font-medium mb-0.5 flex items-center gap-1">
                            <Wrench className="w-3 h-3" /> Recommended Edits:
                          </p>
                          <p className="text-xs text-slate-700 bg-white border border-blue-200 rounded px-2 py-1.5 whitespace-pre-wrap">{event.recommendedEdits}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            }

            if (event.type === "progress") {
              const isGood = ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(event.status);
              return (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-green-500 border-2 border-white flex items-center justify-center">
                    <CheckCircle2 className="w-2 h-2 text-white" />
                  </div>
                  <Card className="border-green-200 bg-green-50">
                    <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wide flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> <StatusPill status={event.status} />
                      </p>
                      <p className="text-xs text-slate-400">{formatDate(event.date)} · {event.changedBy || "—"}</p>
                    </CardContent>
                  </Card>
                </div>
              );
            }

            return null;
          })}

          {/* Final state if still rejected */}
          {!isResolved && (
            <div className="relative">
              <div className="absolute -left-6 top-2 w-4 h-4 rounded-full bg-yellow-400 border-2 border-white flex items-center justify-center">
                <Clock className="w-2 h-2 text-white" />
              </div>
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-3">
                  <p className="text-xs font-bold text-yellow-700 uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Awaiting Resubmission / Resolution
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Quote has been rejected {rejectionCount} time{rejectionCount !== 1 ? "s" : ""}. Coaching reviews and recommended edits are above.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}