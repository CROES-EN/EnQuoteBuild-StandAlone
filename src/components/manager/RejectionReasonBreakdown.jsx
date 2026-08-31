import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { subDays } from "date-fns";

// Map free-text themes → canonical buckets
const THEME_MAP = [
  { key: "Pricing / Labor", terms: ["pricing", "price", "cost", "labor", "rate", "hours", "labor hours", "flat fee", "under-priced", "over-priced", "travel rate"] },
  { key: "Scope of Work", terms: ["scope", "detail", "description", "vague", "unclear", "not described", "scope of work"] },
  { key: "Missing Documentation", terms: ["missing", "incomplete", "documentation", "photos", "photo", "evidence", "no attachment", "attachment"] },
  { key: "Line Item Issues", terms: ["line item", "parts", "materials", "quantity", "sku", "equipment", "component", "part number", "item"] },
  { key: "Justification", terms: ["justification", "justify", "reason", "why", "technical", "not justified"] },
  { key: "Travel / Mileage", terms: ["travel", "mileage", "miles", "distance"] },
  { key: "Approval / Process", terms: ["approval", "authorization", "process", "compliance", "format", "duplicate", "already", "covered", "warranty"] },
  { key: "Pricing: Over Budget", terms: ["over budget", "too high", "too expensive", "budget"] },
];

const BAR_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#ec4899"
];

function bucketText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const theme of THEME_MAP) {
    if (theme.terms.some(t => lower.includes(t))) return theme.key;
  }
  return "Other";
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: d } = payload[0];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-slate-800 mb-0.5">{d.bucket}</p>
      <p className="text-slate-600">{value} review{value !== 1 ? "s" : ""} flagged</p>
    </div>
  );
};

export default function RejectionReasonBreakdown({ reviews, quotes }) {
  const cutoff = subDays(new Date(), 60);

  const chartData = useMemo(() => {
    // Filter reviews completed or created in last 60 days
    const recent = reviews.filter(r => {
      const d = new Date(r.completed_date || r.created_date || r.updated_date);
      return d >= cutoff;
    });

    const counts = {};

    recent.forEach(r => {
      // Priority: manual rejection_driver field
      let bucket = r.rejection_driver ? r.rejection_driver : null;

      // Fall back: scan coaching_notes + recommended_edits
      if (!bucket) {
        const combinedText = [r.coaching_notes, r.recommended_edits, r.rejection_reason_snapshot].filter(Boolean).join(" ");
        bucket = bucketText(combinedText);
      }

      if (!bucket) bucket = "Other";
      counts[bucket] = (counts[bucket] || 0) + 1;
    });

    // Also scan rejection reasons on rejected quotes from last 60 days (for completeness)
    const recentRejected = quotes.filter(q => {
      const d = new Date(q.updated_date || q.created_date);
      return d >= cutoff && q.status === "rejected" && q.rejection_reason;
    });

    // Only add quotes that don't already have a review covering them
    const reviewedIds = new Set(reviews.map(r => r.quote_id));
    recentRejected
      .filter(q => !reviewedIds.has(q.id))
      .forEach(q => {
        const bucket = bucketText(q.rejection_reason) || "Other";
        counts[bucket] = (counts[bucket] || 0) + 1;
      });

    return Object.entries(counts)
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count);
  }, [reviews, quotes]);

  const total = chartData.reduce((s, d) => s + d.count, 0);

  if (!total) {
    return <p className="text-sm text-slate-400 py-6 text-center">No review data in the last 60 days.</p>;
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="bucket"
            width={148}
            tick={{ fontSize: 11, fill: "#475569" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f1f5f9" }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* % breakdown pills */}
      <div className="flex flex-wrap gap-2 pt-1">
        {chartData.map((d, i) => (
          <span
            key={d.bucket}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
            />
            {d.bucket} — {Math.round((d.count / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}