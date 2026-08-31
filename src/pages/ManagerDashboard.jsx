import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getCurrentUser, getQuotes, getReviews } from "@/api/dataClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import RejectionRateChart from "@/components/manager/RejectionRateChart";
import CommonRejectionReasons from "@/components/manager/CommonRejectionReasons";
import FeedbackThemes from "@/components/manager/FeedbackThemes";
import TurnaroundByTeam from "@/components/manager/TurnaroundByTeam";
import RejectionReasonBreakdown from "@/components/manager/RejectionReasonBreakdown";
import { TrendingDown, AlertCircle, MessageSquare, Timer, Lock, PieChart } from "lucide-react";

const ALLOWED_USERS = ["tjm8189", "vseganos"];

export default function ManagerDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    getCurrentUser().then(user => {
      setCurrentUser(user);
      setAccessChecked(true);
    }).catch(() => setAccessChecked(true));
  }, []);

  const emailPrefix = currentUser?.email?.split("@")[0]?.toLowerCase() || "";
  const isAdmin = currentUser?.role === "admin";
  const isAllowed = isAdmin || ALLOWED_USERS.some(u => emailPrefix.includes(u));
  const { data: quotes = [], isLoading: loadingQuotes } = useQuery({
    queryKey: ["manager-quotes"],
    queryFn: async () => {
      const all = await getQuotes();
      return all.filter(q => q.is_current_version !== false);
    },
  });

  const { data: reviews = [], isLoading: loadingReviews } = useQuery({
    queryKey: ["manager-reviews"],
    queryFn: getReviews,
  });

  const loading = loadingQuotes || loadingReviews;

  const totalQuotes = quotes.length;
  const totalRejected = quotes.filter(q => q.status === "rejected").length;
  const overallRejectionRate = totalQuotes > 0 ? Math.round((totalRejected / totalQuotes) * 100) : 0;
  const completedReviews = reviews.filter(r => r.review_status === "completed").length;

  if (!accessChecked || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
        <Lock className="w-12 h-12 text-orange-400" />
        <h2 className="text-xl font-semibold text-slate-700">Access Restricted</h2>
        <p className="text-slate-500 max-w-md">
          The Manager Dashboard is only accessible to authorized managers and admins.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Manager Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Rejection trends, coaching feedback, and team turnaround analysis to identify training opportunities.
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Quotes</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{totalQuotes}</p>
          </CardContent>
        </Card>
        <Card className="border-red-100">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Rejected</p>
            <p className="text-3xl font-bold text-red-600 mt-1">{totalRejected}</p>
          </CardContent>
        </Card>
        <Card className={`border-slate-200 ${overallRejectionRate >= 30 ? "bg-red-50" : ""}`}>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Overall Rejection Rate</p>
            <p className={`text-3xl font-bold mt-1 ${overallRejectionRate >= 30 ? "text-red-600" : "text-slate-800"}`}>
              {overallRejectionRate}%
            </p>
          </CardContent>
        </Card>
        <Card className="border-green-100">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Reviews Completed</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{completedReviews}</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 1: Rejection Rate by Submitter + Common Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Rejection Rate by Submitter
            </CardTitle>
            <p className="text-xs text-slate-400">Red ≥40% · Orange 20–39% · Green &lt;20%</p>
          </CardHeader>
          <CardContent>
            <RejectionRateChart quotes={quotes} />
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Common Rejection Reasons
            </CardTitle>
            <p className="text-xs text-slate-400">Click a category to see affected quotes</p>
          </CardHeader>
          <CardContent>
            <CommonRejectionReasons quotes={quotes} />
          </CardContent>
        </Card>
      </div>

      {/* Rejection Reason Breakdown — last 60 days */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <PieChart className="w-4 h-4 text-red-500" />
            Rejection Reason Breakdown
          </CardTitle>
          <p className="text-xs text-slate-400">What's driving rejections — last 60 days of reviews &amp; feedback</p>
        </CardHeader>
        <CardContent>
          <RejectionReasonBreakdown reviews={reviews} quotes={quotes} />
        </CardContent>
      </Card>

      {/* Row 2: Feedback Themes + Turnaround */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              Coaching Feedback Themes
            </CardTitle>
            <p className="text-xs text-slate-400">Topics most frequently flagged in review feedback</p>
          </CardHeader>
          <CardContent>
            <FeedbackThemes reviews={reviews} quotes={quotes} canEdit={isAllowed} />
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
              <Timer className="w-4 h-4 text-indigo-500" />
              Turnaround Time by Submitter
            </CardTitle>
            <p className="text-xs text-slate-400">Average days per stage — highlights training gaps</p>
          </CardHeader>
          <CardContent>
            <TurnaroundByTeam quotes={quotes} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}