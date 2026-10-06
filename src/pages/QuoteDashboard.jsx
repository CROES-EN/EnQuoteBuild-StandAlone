import {useQuery} from "@tanstack/react-query";
import {getAllQuoteActivities, getQuotes, getReviews} from "@/api/dataClient";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import RejectionRateChart from "@/components/manager/RejectionRateChart";
import CommonRejectionReasons from "@/components/manager/CommonRejectionReasons";
import FeedbackThemes from "@/components/manager/FeedbackThemes";
import TurnaroundByTeam from "@/components/manager/TurnaroundByTeam";
import RejectionReasonBreakdown from "@/components/manager/RejectionReasonBreakdown";
import {AlertCircle, MessageSquare, PieChart, Timer, TrendingDown} from "lucide-react";
import {Button} from "@/components/ui/button";
import QuoteLifecyclePanel from "@/components/quote-dashboard/QuoteLifecyclePanel";

export default function QuoteDashboard({embedded = false}) {
  const quotesQuery = useQuery({
    queryKey: ["quotes", "lifecycle"],
    queryFn: async () => {
      const all = await getQuotes();
      return all.filter(q => q.is_current_version !== false);
    },
  });

  const reviewsQuery = useQuery({
    queryKey: ["manager-reviews"],
    queryFn: getReviews,
  });
  const activityQuery = useQuery({
    queryKey: ["quoteActivity", "lifecycle"],
    queryFn: async () => {
      const activities = await getAllQuoteActivities();
      if (!Array.isArray(activities)) throw new Error("Quote activity service returned an invalid response.");
      return activities;
    }
  });

  if (quotesQuery.isError || activityQuery.isError) {
    const failedQuery = quotesQuery.isError ? quotesQuery : activityQuery;
    return <Card role="alert" className="p-6 space-y-3">
      <h2 className="font-semibold">Unable to load Quote Dashboard</h2>
      <p className="text-sm text-muted-foreground">{failedQuery.error?.message || "Quote history or activity data is unavailable."}</p>
      <p className="text-sm text-muted-foreground">Charts are not shown because source records could not be loaded completely.</p>
      <Button disabled={failedQuery.isFetching} onClick={() => failedQuery.refetch()}>Try Again</Button>
    </Card>;
  }
  if (quotesQuery.isLoading || activityQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-border border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  const quotes = quotesQuery.data || [];
  const reviews = reviewsQuery.data || [];
  return (
    <div className={embedded ? "space-y-6" : "p-6 max-w-6xl mx-auto space-y-6"}>
      <div>
        {embedded
          ? <h2 className="text-xl font-bold text-foreground">Quote Dashboard</h2>
          : <h1 className="text-2xl font-bold text-foreground">Quote Dashboard</h1>}
        <p className="text-muted-foreground mt-1">
          Quote creation, status movement, stage turnaround, current aging, and recorded lifetime history.
        </p>
      </div>

      <QuoteLifecyclePanel quotes={quotes} activities={activityQuery.data || []} />
      <details className="space-y-6">
        <summary className="cursor-pointer font-semibold">Rejection and coaching analysis (all-time; breakdown uses last 60 days)</summary>
        <p className="text-sm text-muted-foreground">These existing analyses are separate from the lifecycle activity filters above.</p>
        {reviewsQuery.isError ? <Card role="alert" className="p-4 space-y-3">
          <p>Unable to load coaching/review data: {reviewsQuery.error?.message || "Reviews unavailable."}</p>
          <Button disabled={reviewsQuery.isFetching} onClick={() => reviewsQuery.refetch()}>Retry Reviews</Button>
        </Card> : reviewsQuery.isLoading ? <p>Loading review analysis...</p> : <>

      {/* Row 1: Rejection Rate by Submitter + Common Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Rejection Rate by Submitter
            </CardTitle>
            <p className="text-xs text-muted-foreground">Red ≥40% · Orange 20–39% · Green &lt;20%</p>
          </CardHeader>
          <CardContent>
            <RejectionRateChart quotes={quotes} />
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Common Rejection Reasons
            </CardTitle>
            <p className="text-xs text-muted-foreground">Click a category to see affected quotes</p>
          </CardHeader>
          <CardContent>
            <CommonRejectionReasons quotes={quotes} />
          </CardContent>
        </Card>
      </div>

      {/* Rejection Reason Breakdown — last 60 days */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <PieChart className="w-4 h-4 text-red-500" />
            Rejection Reason Breakdown
          </CardTitle>
          <p className="text-xs text-muted-foreground">What&apos;s driving rejections — last 60 days of reviews &amp; feedback</p>
        </CardHeader>
        <CardContent>
          <RejectionReasonBreakdown reviews={reviews} quotes={quotes} />
        </CardContent>
      </Card>

      {/* Row 2: Feedback Themes + Turnaround */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              Coaching Feedback Themes
            </CardTitle>
            <p className="text-xs text-muted-foreground">Topics most frequently flagged in review feedback</p>
          </CardHeader>
          <CardContent>
            <FeedbackThemes reviews={reviews} quotes={quotes} canEdit />
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Timer className="w-4 h-4 text-indigo-500" />
              Turnaround Time by Submitter
            </CardTitle>
            <p className="text-xs text-muted-foreground">Average days per stage — highlights training gaps</p>
          </CardHeader>
          <CardContent>
            <TurnaroundByTeam quotes={quotes} />
          </CardContent>
        </Card>
      </div>
        </>}
      </details>
    </div>
  );
}