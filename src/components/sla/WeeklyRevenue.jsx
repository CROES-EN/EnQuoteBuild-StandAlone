import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart } from "recharts";
import { startOfWeek, format, subWeeks, parseISO, isAfter, isBefore } from "date-fns";
import { DollarSign } from "lucide-react";

function formatCurrency(v) {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function WeeklyRevenue({ quotes, dateRange }) {
  const weeksBack = Math.min(Math.ceil(parseInt(dateRange) / 7), 26);

  const weeklyData = Array.from({ length: weeksBack }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(new Date(), weeksBack - 1 - i), { weekStartsOn: 1 });
    const weekEnd = startOfWeek(subWeeks(new Date(), weeksBack - 2 - i), { weekStartsOn: 1 });

    const weekQuotes = quotes.filter(q => {
      const d = parseISO(q.created_date);
      return isAfter(d, weekStart) && isBefore(d, weekEnd);
    });

    const revenue = weekQuotes.reduce((s, q) => s + (q.total || 0), 0);
    const paid = quotes.filter(q => {
      const d = q.invoice_paid_date ? parseISO(q.invoice_paid_date) : null;
      return d && isAfter(d, weekStart) && isBefore(d, weekEnd);
    }).reduce((s, q) => s + (q.total || 0), 0);

    return {
      week: format(weekStart, "MMM d"),
      quoted: revenue,
      collected: paid,
      count: weekQuotes.length,
    };
  });

  const totalQuoted = weeklyData.reduce((s, w) => s + w.quoted, 0);
  const totalCollected = weeklyData.reduce((s, w) => s + w.collected, 0);
  const thisWeek = weeklyData[weeklyData.length - 1]?.quoted || 0;
  const lastWeek = weeklyData[weeklyData.length - 2]?.quoted || 0;
  const trend = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(0) : null;

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-600" />
          <h3 className="text-lg font-semibold text-slate-900">Weekly Revenue Flow</h3>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-500">
          <span>Quoted: <span className="font-semibold text-slate-700">{formatCurrency(totalQuoted)}</span></span>
          <span>Collected: <span className="font-semibold text-emerald-700">{formatCurrency(totalCollected)}</span></span>
          {trend !== null && (
            <span className={parseInt(trend) >= 0 ? "text-green-600 font-semibold" : "text-rose-600 font-semibold"}>
              {parseInt(trend) >= 0 ? "+" : ""}{trend}% vs last week
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={weeklyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={formatCurrency} />
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
            formatter={(v, name) => [formatCurrency(v), name === "quoted" ? "Quoted" : "Collected"]}
          />
          <Bar dataKey="quoted" fill="#6366f1" radius={[4, 4, 0, 0]} name="quoted" />
          <Bar dataKey="collected" fill="#10b981" radius={[4, 4, 0, 0]} name="collected" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /> Quoted Value</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Collected (Paid)</span>
      </div>
    </Card>
  );
}