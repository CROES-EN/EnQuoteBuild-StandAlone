import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Brain, RefreshCw, TrendingDown, ChevronDown, ChevronUp, Lightbulb, Target } from "lucide-react";

const severityColors = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};

const severityBorder = {
  critical: "border-l-4 border-l-red-500",
  high: "border-l-4 border-l-orange-500",
  medium: "border-l-4 border-l-yellow-400",
  low: "border-l-4 border-l-blue-400",
};

function InsightCard({ insight, index }) {
  const [expanded, setExpanded] = useState(index < 3);

  return (
    <Card className={`border-slate-200 ${severityBorder[insight.severity] || "border-l-4 border-l-slate-300"}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 shrink-0">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge className={`text-xs ${severityColors[insight.severity] || "bg-slate-100 text-slate-600"}`}>
                  {insight.severity?.toUpperCase()}
                </Badge>
                <Badge className="text-xs bg-slate-100 text-slate-600">{insight.category}</Badge>
                {insight.estimated_impact_percent != null && (
                  <Badge className="text-xs bg-indigo-100 text-indigo-700">
                    ~{insight.estimated_impact_percent}% of rejections
                  </Badge>
                )}
              </div>
              <CardTitle className="text-sm font-semibold text-slate-800 leading-snug">
                {insight.title}
              </CardTitle>
            </div>
          </div>
          <button className="shrink-0 text-slate-400 hover:text-slate-600">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm text-slate-600 leading-relaxed">{insight.description}</p>

          {insight.evidence?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Evidence from quotes</p>
              <ul className="space-y-1">
                {insight.evidence.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insight.recommendation && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <p className="text-xs text-green-800 leading-relaxed">{insight.recommendation}</p>
            </div>
          )}

          {insight.enphase_context && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-start gap-2">
              <Target className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-800 leading-relaxed">{insight.enphase_context}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const STORAGE_KEY = "rejection_analysis_cache";

export default function RejectionInterpretations({ allQuotes = [], allReviews = [], users = [] }) {
  const [analysis, setAnalysis] = useState(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const { data } = JSON.parse(cached);
        return data || null;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const { timestamp } = JSON.parse(cached);
        return timestamp ? new Date(timestamp) : null;
      }
    } catch {}
    return null;
  });
  const [error, setError] = useState(null);

  const buildContext = () => {
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u.full_name || u.email?.split("@")[0] || u.id; });
    const resolve = (raw) => {
      if (!raw) return "Unknown";
      if (userMap[raw]) return userMap[raw];
      return raw.split("@")[0];
    };

    const rejected = allQuotes.filter(q => q.status === "rejected");

    const quoteSummaries = rejected.map(q => {
      const submitEntry = (q.status_history || []).find(h => h.status === "submitted");
      const rejEntry = [...(q.status_history || [])].reverse().find(h => h.status === "rejected");
      const review = allReviews.find(r => r.quote_id === q.id && r.review_status === "completed");
      return {
        quote_number: q.quote_number,
        site_id: q.site_id,
        total_value: q.total,
        scope_of_work: q.scope_of_work,
        items_count: q.items?.length || 0,
        item_names: (q.items || []).map(i => i.name).join(", "),
        submitted_by: resolve(submitEntry?.changed_by || q.created_by_id),
        rejected_by: resolve(rejEntry?.changed_by),
        rejection_reason: q.rejection_reason,
        coaching_notes: review?.coaching_notes || null,
        recommended_edits: review?.recommended_edits || null,
      };
    });

    return quoteSummaries;
  };

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const quoteSummaries = buildContext();

      if (quoteSummaries.length === 0) {
        setAnalysis({ insights: [], summary: "No rejected quotes found to analyze.", top_categories: [] });
        setLastRun(new Date());
        setLoading(false);
        return;
      }

      // Truncate long fields and cap at 50 quotes to avoid timeouts
      const truncated = quoteSummaries.slice(0, 50).map(q => ({
        ...q,
        scope_of_work: q.scope_of_work ? q.scope_of_work.slice(0, 300) : null,
        rejection_reason: q.rejection_reason ? q.rejection_reason.slice(0, 300) : null,
        coaching_notes: q.coaching_notes ? q.coaching_notes.slice(0, 200) : null,
        recommended_edits: q.recommended_edits ? q.recommended_edits.slice(0, 200) : null,
      }));

      const response = await base44.functions.invoke("analyzeRejections", { quoteSummaries: truncated });
      const result = response.data;
      const now = new Date();
      setAnalysis(result);
      setLastRun(now);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ data: result, timestamp: now.toISOString() }));
      } catch {}
    } catch (err) {
      console.error(err);
      setError(err?.message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const categoryColors = {
    red: "bg-red-500",
    orange: "bg-orange-400",
    yellow: "bg-yellow-400",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
  };

  const rejectedCount = allQuotes.filter(q => q.status === "rejected").length;

  return (
    <div className="space-y-6">
      {/* Header / Trigger */}
      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Brain className="w-6 h-6 text-indigo-600 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-slate-800">AI Rejection Analysis</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Scans up to 50 of the {rejectedCount} rejected quotes — rejection reasons, scope of work, line items, and coaching notes — using Enphase residential solar domain knowledge to identify patterns and root causes.
                </p>
                {lastRun && (
                  <p className="text-xs text-slate-400 mt-1.5">Last analyzed: {lastRun.toLocaleTimeString()}</p>
                )}
              </div>
            </div>
            <Button
              onClick={runAnalysis}
              disabled={loading}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : analysis ? (
                <><RefreshCw className="w-4 h-4 mr-2" /> Re-analyze</>
              ) : (
                <><Brain className="w-4 h-4 mr-2" /> Run Analysis</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && !loading && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="text-center py-16 text-slate-400">
          <Brain className="w-10 h-10 mx-auto mb-3 text-indigo-300 animate-pulse" />
          <p className="font-medium text-slate-600">Analyzing {rejectedCount} rejected quotes...</p>
          <p className="text-sm mt-1">Applying Enphase domain knowledge and cross-referencing all rejection data.</p>
          <p className="text-xs mt-2 text-slate-400">This may take 20–40 seconds.</p>
        </div>
      )}

      {!loading && analysis && (
        <>
          {/* Executive Summary */}
          <Card className="border-slate-200">
            <CardContent className="p-5">
              <p className="text-sm text-slate-700 leading-relaxed italic">"{analysis.summary}"</p>
              <p className="text-xs text-slate-400 mt-2">— Based on {analysis.total_analyzed} rejected quotes</p>
            </CardContent>
          </Card>

          {/* Category Breakdown */}
          {analysis.top_categories?.length > 0 && (
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  Failure Category Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.top_categories.map((cat, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 font-medium">{cat.category}</span>
                      <span className="text-slate-500 font-semibold">{cat.percent}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${categoryColors[cat.color] || "bg-slate-400"}`}
                        style={{ width: `${Math.min(cat.percent, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Insights */}
          {analysis.insights?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                Detailed Findings ({analysis.insights.length})
              </h3>
              {analysis.insights.map((insight, i) => (
                <InsightCard key={i} insight={insight} index={i} />
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !analysis && (
        <div className="text-center py-16 text-slate-400">
          <Brain className="w-10 h-10 mx-auto mb-3 text-slate-200" />
          <p className="text-slate-500 font-medium">Click "Run Analysis" to get AI-powered insights</p>
          <p className="text-sm mt-1">Uses Claude to scan all rejection data with Enphase domain knowledge.</p>
        </div>
      )}
    </div>
  );
}