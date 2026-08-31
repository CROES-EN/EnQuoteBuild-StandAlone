import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { getReviews, updateReview } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, CheckCircle, ChevronDown, ChevronRight, Clock, X, CheckCheck } from "lucide-react";

/**
 * A review is considered "cleared" (hidden from dashboard) when the
 * submitter has dismissed it. If a manager later saves new coaching
 * content, QuoteReviewPanel resets cleared_by_submitter to false so
 * the alert re-surfaces.
 */
function isCleared(review) {
  return review.cleared_by_submitter === true;
}

export default function CoachingFeedback({ currentUserEmail }) {
  const [expanded, setExpanded] = useState({});
  const queryClient = useQueryClient();

  const { data: myQuotes = [] } = useQuery({
    queryKey: ["myQuotes", currentUserEmail],
    queryFn: getQuotes,
    enabled: !!currentUserEmail,
  });

  const myQuoteIds = myQuotes
    .filter(q => {
      const history = q.status_history || [];
      return history.some(h => h.status === "submitted" && h.changed_by === currentUserEmail);
    })
    .map(q => q.id);

  const { data: allReviews = [], isLoading } = useQuery({
    queryKey: ["coachingReviews"],
    queryFn: getReviews,
  });

  const myReviews = allReviews.filter(r =>
    myQuoteIds.includes(r.quote_id) &&
    r.review_status !== "pending" &&
    !isCleared(r)
  );

  const unread = myReviews.filter(r => r.review_status !== "completed");

  const markReviewed = useMutation({
    mutationFn: (reviewId) => updateReview(reviewId, {
      review_status: "completed",
      completed_date: new Date().toISOString(),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coachingReviews"] }),
  });

  const clearReview = useMutation({
    mutationFn: (reviewId) => updateReview(reviewId, {
      cleared_by_submitter: true,
      cleared_date: new Date().toISOString(),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coachingReviews"] }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await Promise.all(myReviews.map(r =>
        updateReview(r.id, {
          cleared_by_submitter: true,
          cleared_date: now,
        })
      ));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coachingReviews"] }),
  });

  if (isLoading) return null;
  if (myReviews.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50 mb-6">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <GraduationCap className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold text-amber-900">Coaching Feedback</h3>
          {unread.length > 0 && (
            <Badge className="bg-amber-500 text-white text-xs">{unread.length} unread</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 ml-auto"
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1" />
            Clear All
          </Button>
        </div>

        <div className="space-y-3">
          {myReviews.map(review => {
            const isExpanded = expanded[review.id];
            const isRead = review.review_status === "completed";

            return (
              <div
                key={review.id}
                className={`rounded-lg border p-3 bg-white ${isRead ? "border-slate-200 opacity-75" : "border-amber-300"}`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-2 min-w-0 cursor-pointer flex-1"
                    onClick={() => setExpanded(prev => ({ ...prev, [review.id]: !prev[review.id] }))}
                  >
                    {isRead
                      ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      : <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                    }
                    <span className="font-medium text-slate-800 text-sm">
                      Quote {review.quote_number || review.quote_id}
                      {review.site_id && <span className="text-slate-500 font-normal"> — Site {review.site_id}</span>}
                    </span>
                    {!isRead && (
                      <Badge className="bg-amber-100 text-amber-700 border border-amber-300 text-xs">New Feedback</Badge>
                    )}
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  </div>
                  <button
                    onClick={() => clearReview.mutate(review.id)}
                    disabled={clearReview.isPending}
                    className="text-slate-300 hover:text-rose-500 transition-colors ml-2 shrink-0"
                    title="Clear"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-3 text-sm">
                    {review.rejection_reason_snapshot && (
                      <div>
                        <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Rejection Reason</p>
                        <p className="text-slate-700 bg-red-50 rounded p-2 border border-red-100">{review.rejection_reason_snapshot}</p>
                      </div>
                    )}
                    {review.coaching_notes && (
                      <div>
                        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Coaching Notes</p>
                        <p className="text-slate-700 bg-amber-50 rounded p-2 border border-amber-100">{review.coaching_notes}</p>
                      </div>
                    )}
                    {review.recommended_edits && (
                      <div>
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Required Edits</p>
                        <p className="text-slate-700 bg-blue-50 rounded p-2 border border-blue-100">{review.recommended_edits}</p>
                      </div>
                    )}
                    {!isRead && (
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white mt-1"
                        onClick={() => markReviewed.mutate(review.id)}
                        disabled={markReviewed.isPending}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        Mark as Reviewed
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}