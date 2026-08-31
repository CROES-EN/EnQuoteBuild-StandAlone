import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { startOfWeek, format, subWeeks, parseISO, isAfter, isBefore } from "date-fns";
import { TrendingUp } from "lucide-react";

export default function WeeklyInflow({ quotes, dateRange }) {
  const weeksBack = Math.min(Math.ceil(parseInt(dateRange) / 7), 26);

  const weeklyData = Array.from({ length: weeksBack }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(new Date(), weeksBack - 1 - i), { weekStartsOn: 1 });
    const weekEnd = startOfWeek(subWeeks(new Date(), weeksBack - 2 - i), { weekStartsOn: 1 });
    const count = quotes.filter(q => {
      const d = parseISO(q.created_date);
      return isAfter(d, weekStart) && isBefore(d, weekEnd);
    }).length;
    return {
      week: format(weekStart, "MMM d"),
      count
    };
  });

  const totalInflow = weeklyData.reduce((s, w) => s + w.count, 0);
  const avgPerWeek = weeksBack > 0 ? (totalInflow / weeksBack).toFixed(1) : 0;
  const thisWeek = weeklyData[weeklyData.length - 1]?.count || 0;
  const lastWeek = weeklyData[weeklyData.length - 2]?.count || 0;
  const trend = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(0) : null;

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-slate-900">Weekly New Quote Inflow</h3>
        </div>
        <div className="flex gap-4 text-sm text-slate-500">
          <span><span className="font-semibold text-slate-700">{totalInflow}</span> total</span>
          <span><span className="font-semibold text-slate-700">{avgPerWeek}</span> avg/week</span>
          {trend !== null && (
            <span className={parseInt(trend) >= 0 ? "text-green-600 font-semibold" : "text-rose-600 font-semibold"}>
              {parseInt(trend) >= 0 ? "+" : ""}{trend}% vs last week
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [v, "Quotes"]}
          />
          <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}