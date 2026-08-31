import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createReview, getReviews, updateReview } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Clock, FileText, AlertCircle, ChevronDown, ChevronUp, GripVertical, ClipboardList } from "lucide-react";

const formatCurrency = (v) => `$${(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const formatDate = (d) => d ? new Date(d).toLocaleDateString() : "—";

export default function QuoteReviewPanel({ quote, currentUser, onClose }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [lineItemsWidth, setLineItemsWidth] = useState(null);
  const lineItemsRef = useRef(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = lineItemsRef.current?.offsetWidth || 600;
    
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(300, startWidth.current + delta);
      setLineItemsWidth(newWidth);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const { data: existingReviews = [] } = useQuery({
    queryKey: ["quote-reviews", quote.id],
    queryFn: () => getReviews(quote.id),
  });

  const myReview = existingReviews.find(r => r.reviewer_email === currentUser?.email);

  const [coaching, setCoaching] = useState(myReview?.coaching_notes || "");
  const [recommended, setRecommended] = useState(myReview?.recommended_edits || "");

  const saveReview = useMutation({
    mutationFn: async (status) => {
      const payload = {
        quote_id: quote.id,
        quote_number: quote.quote_number,
        site_id: quote.site_id,
        reviewer_email: currentUser?.email,
        rejection_reason_snapshot: quote.rejection_reason,
        coaching_notes: coaching,
        recommended_edits: recommended,
        review_status: status,
        cleared_by_submitter: false,
        ...(status === "completed" ? { completed_date: new Date().toISOString() } : {}),
      };
      if (myReview?.id) {
        return updateReview(myReview.id, payload);
      }
      return createReview(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-reviews", quote.id] });
      queryClient.invalidateQueries({ queryKey: ["quote-reviews-all"] });
      queryClient.invalidateQueries({ queryKey: ["coachingReviews"] });
    },
  });

  // Follow-up log entries from status_history
  const followUpEntries = (quote.status_history || []).filter(h => h.entry_type === "follow_up");

  const rejectedBy = quote.status_history
    ?.filter(h => h.status === "rejected")
    ?.slice(-1)[0];

  const reviewStatus = myReview?.review_status || "pending";

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
  };

  const otherReviews = existingReviews.filter(r => r.reviewer_email !== currentUser?.email);

  return (
    <div className="flex flex-col gap-4">
      {/* Quote Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Quote #{quote.quote_number || "—"}
          </h2>
          <p className="text-sm text-slate-500">Site ID: {quote.site_id}</p>
        </div>
        <Badge className={statusColors[reviewStatus]}>
          {reviewStatus === "pending" && <Clock className="w-3 h-3 mr-1" />}
          {reviewStatus === "in_progress" && <FileText className="w-3 h-3 mr-1" />}
          {reviewStatus === "completed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
          {reviewStatus.replace("_", " ")}
        </Badge>
      </div>

      {/* Rejection Details — Read Only */}
      <Card className="border-red-200 bg-red-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Rejection Details (Read Only)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Rejected By</p>
              <p className="font-medium text-slate-800">{rejectedBy?.changed_by || "ajennings"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Rejected On</p>
              <p className="font-medium text-slate-800">{formatDate(rejectedBy?.changed_at)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Quote Total</p>
              <p className="font-medium text-slate-800">{formatCurrency(quote.total)}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Rejection Reason</p>
            <p className="text-slate-800 bg-white border border-red-200 rounded-md px-3 py-2 whitespace-pre-wrap">
              {quote.rejection_reason || "No reason provided."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quote Summary — collapsible */}
      <Card className="border-slate-200">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-xl"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" /> Quote Summary
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        {expanded && (
          <CardContent className="pt-0 text-sm space-y-3">
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Case Number</p>
                <p className="font-medium">{quote.case_number || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Valid Until</p>
                <p className="font-medium">{formatDate(quote.valid_until)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">FST Count</p>
                <p className="font-medium">{quote.fst_count ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Labor Hours</p>
                <p className="font-medium">{quote.labor_hours ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Labor Rate</p>
                <p className="font-medium">{formatCurrency(quote.labor_rate)}/hr</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Subtotal</p>
                <p className="font-medium">{formatCurrency(quote.subtotal)}</p>
              </div>
            </div>
            {quote.scope_of_work && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Scope of Work</p>
                <p className="bg-slate-50 rounded-md px-3 py-2 text-slate-700 whitespace-pre-wrap">{quote.scope_of_work}</p>
              </div>
            )}
            {quote.items?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-500">Line Items</p>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <GripVertical className="w-3 h-3" /> drag right edge to resize
                  </span>
                </div>
                <div
                  ref={lineItemsRef}
                  className="relative overflow-x-auto border border-slate-200 rounded-md"
                  style={{ width: lineItemsWidth ? `${lineItemsWidth}px` : "100%" }}
                >
                  <table className="text-xs" style={{ minWidth: "500px", width: "100%" }}>
                    <thead>
                      <tr className="text-slate-400 border-b bg-slate-50">
                        <th className="text-left py-1 px-2">Item</th>
                        <th className="text-left py-1 px-2">Description</th>
                        <th className="text-right py-1 px-2 whitespace-nowrap">Qty</th>
                        <th className="text-right py-1 px-2 whitespace-nowrap">Unit Price</th>
                        <th className="text-right py-1 px-2 whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.items.map((item, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1 px-2 text-slate-700 font-medium whitespace-nowrap">{item.name}</td>
                          <td className="py-1 px-2 text-slate-500 max-w-xs">{item.description || "—"}</td>
                          <td className="py-1 px-2 text-right whitespace-nowrap">{item.quantity} {item.unit}</td>
                          <td className="py-1 px-2 text-right whitespace-nowrap">{formatCurrency(item.unit_price)}</td>
                          <td className="py-1 px-2 text-right font-medium whitespace-nowrap">{formatCurrency(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Resize handle */}
                  <div
                    onMouseDown={onMouseDown}
                    className="absolute top-0 right-0 w-3 h-full cursor-ew-resize flex items-center justify-center bg-slate-100 hover:bg-slate-300 border-l border-slate-200 transition-colors"
                    title="Drag to resize"
                  >
                    <GripVertical className="w-3 h-3 text-slate-400" />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* My Review Feedback */}
      <Card className="border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-blue-700">Your Review Feedback</CardTitle>
          <p className="text-xs text-slate-500">Reviewing as: {currentUser?.email}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {followUpEntries.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-md p-3 space-y-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1">
                <ClipboardList className="w-3 h-3" /> Follow-Up Notes (from quote log)
              </p>
              {followUpEntries.map((h, i) => (
                <div key={i} className="text-xs text-slate-700 bg-white border border-indigo-100 rounded px-2 py-1.5">
                  <span className="text-slate-400 mr-1">{h.changed_by} · {h.changed_at ? new Date(h.changed_at).toLocaleDateString() : "—"}:</span>
                  <span className="whitespace-pre-wrap">{h.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide block mb-1">
              Coaching Notes
            </label>
            <Textarea
              value={coaching}
              onChange={e => setCoaching(e.target.value)}
              placeholder="Provide coaching and feedback for the submitter..."
              className="min-h-[100px] resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide block mb-1">
              Recommended Edits to Meet Approval Requirements
            </label>
            <Textarea
              value={recommended}
              onChange={e => setRecommended(e.target.value)}
              placeholder="List specific changes needed for ajennings to approve and send to HO..."
              className="min-h-[100px] resize-y"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveReview.mutate("in_progress")}
              disabled={saveReview.isPending}
            >
              Save Draft
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => saveReview.mutate("completed")}
              disabled={saveReview.isPending || (!coaching && !recommended)}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Complete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Other Reviewers' Notes */}
      {otherReviews.length > 0 && (
        <Card className="border-slate-200 bg-slate-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600">Other Reviewers' Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {otherReviews.map(r => (
              <div key={r.id} className="space-y-2 text-sm">
                <p className="font-medium text-slate-700">{r.reviewer_email} — <span className="text-xs text-slate-400">{formatDate(r.completed_date || r.created_date)}</span></p>
                {r.coaching_notes && (
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Coaching Notes</p>
                    <p className="bg-white rounded px-3 py-2 text-slate-700 whitespace-pre-wrap border border-slate-200">{r.coaching_notes}</p>
                  </div>
                )}
                {r.recommended_edits && (
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Recommended Edits</p>
                    <p className="bg-white rounded px-3 py-2 text-slate-700 whitespace-pre-wrap border border-slate-200">{r.recommended_edits}</p>
                  </div>
                )}
                <Separator />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}