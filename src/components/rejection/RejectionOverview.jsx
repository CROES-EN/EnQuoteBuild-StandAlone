import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, Minus, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function RejectionOverview({ allQuotes = [], users = [] }) {
  // Build a map from user ID -> display name
  const userIdToName = useMemo(() => {
    const map = {};
    users.forEach(u => {
      map[u.id] = u.full_name || u.email?.split("@")[0] || u.id;
    });
    return map;
  }, [users]);

  const resolveSubmitter = (raw) => {
    if (!raw) return "Unknown";
    // If it looks like a user ID (no @ and no dot), try to resolve it
    if (userIdToName[raw]) return userIdToName[raw];
    // If it's an email, strip domain
    return raw.split("@")[0];
  };

  const stats = useMemo(() => {
    // Only look at submitted + resolved quotes (exclude drafts/on_hold for accurate rates)
    const relevant = allQuotes.filter(q =>
      q.status && !["draft_without_internal", "draft_without_fst", "on_hold"].includes(q.status)
    );

    // Build per-coordinator breakdown
    const coordMap = {};

    relevant.forEach(quote => {
      // Find who submitted the quote
      const submitEntry = (quote.status_history || []).find(h => h.status === "submitted");
      const rawSubmitter = submitEntry?.changed_by || quote.created_by_id || "Unknown";
      const name = resolveSubmitter(rawSubmitter);

      if (!coordMap[name]) {
        coordMap[name] = {
          name,
          total: 0,
          rejected: 0,
          approved: 0,
          currentRejections: 0,
          avgTotal: 0,
          totalValue: 0,
        };
      }

      coordMap[name].total += 1;
      coordMap[name].totalValue += quote.total || 0;

      if (quote.status === "rejected") {
        coordMap[name].rejected += 1;
        coordMap[name].currentRejections += 1;
      }
      if (["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(quote.status)) {
        coordMap[name].approved += 1;
      }
    });

    return Object.values(coordMap)
      .map(c => ({
        ...c,
        rejectionRate: c.total > 0 ? Math.round((c.rejected / c.total) * 100) : 0,
        approvalRate: c.total > 0 ? Math.round((c.approved / c.total) * 100) : 0,
        avgValue: c.total > 0 ? c.totalValue / c.total : 0,
      }))
      .filter(c => c.total >= 1)
      .sort((a, b) => b.rejectionRate - a.rejectionRate);
  }, [allQuotes]);

  const totalRejected = allQuotes.filter(q => q.status === "rejected").length;
  const totalSubmitted = allQuotes.filter(q => q.status !== "draft_without_internal" && q.status !== "draft_without_fst").length;
  const overallRate = totalSubmitted > 0 ? Math.round((totalRejected / totalSubmitted) * 100) : 0;

  const chartData = [...stats]
    .sort((a, b) => b.rejectionRate - a.rejectionRate)
    .slice(0, 12)
    .map(c => ({ name: c.name, rate: c.rejectionRate, current: c.currentRejections }));

  const getRateColor = (rate) => {
    if (rate >= 30) return "text-red-600";
    if (rate >= 15) return "text-orange-500";
    return "text-green-600";
  };

  const getRateBg = (rate) => {
    if (rate >= 30) return "bg-red-50 border-red-200";
    if (rate >= 15) return "bg-orange-50 border-orange-200";
    return "bg-green-50 border-green-200";
  };

  const getTrendIcon = (rate) => {
    if (rate >= 30) return <TrendingUp className="w-4 h-4 text-red-500" />;
    if (rate >= 15) return <Minus className="w-4 h-4 text-orange-400" />;
    return <TrendingDown className="w-4 h-4 text-green-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Overall Rejection Rate</p>
            <p className={`text-2xl font-bold ${getRateColor(overallRate)}`}>{overallRate}%</p>
            <p className="text-xs text-slate-400 mt-1">{totalRejected} of {totalSubmitted} quotes</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Current Open Rejections</p>
            <p className="text-2xl font-bold text-red-600">{totalRejected}</p>
            <p className="text-xs text-slate-400 mt-1">Awaiting resubmission</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">Coordinators Tracked</p>
            <p className="text-2xl font-bold text-slate-800">{stats.length}</p>
            <p className="text-xs text-slate-400 mt-1">With submitted quotes</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500 mb-1">High Risk (&ge;30%)</p>
            <p className="text-2xl font-bold text-orange-600">{stats.filter(s => s.rejectionRate >= 30).length}</p>
            <p className="text-xs text-slate-400 mt-1">Coordinators</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rejection Rate by Coordinator</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 40 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, "Rejection Rate"]} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.rate >= 30 ? "#ef4444" : entry.rate >= 15 ? "#f97316" : "#22c55e"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-Coordinator Table */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Coordinator Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-500">Coordinator</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Total Submitted</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Approved</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Rejected (Open)</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Rejection Rate</th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Approval Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((c) => (
                  <tr key={c.name} className={`border-b border-slate-50 hover:bg-slate-50 ${getRateBg(c.rejectionRate)}`}>
                    <td className="py-2.5 px-4 font-medium text-slate-800 flex items-center gap-2">
                      {getTrendIcon(c.rejectionRate)}
                      {c.name}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-600">{c.total}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="text-green-700 font-medium">{c.approved}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {c.currentRejections > 0 ? (
                        <Badge className="bg-red-100 text-red-700 text-xs">{c.currentRejections}</Badge>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`font-bold ${getRateColor(c.rejectionRate)}`}>{c.rejectionRate}%</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="text-slate-600">{c.approvalRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}