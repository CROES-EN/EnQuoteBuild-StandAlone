import { useState } from "react";
import { Badge } from "@/components/ui/badge";

const KEYWORDS = [
  "pricing", "price", "cost", "labor", "rate", "hours", "scope", "detail", "description",
  "incomplete", "missing", "documentation", "parts", "materials", "travel", "mileage",
  "justification", "approval", "authorization", "budget", "estimate", "breakdown",
  "photos", "photo", "evidence", "warranty", "duplicate", "already", "covered",
];

function extractKeywords(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return KEYWORDS.filter(kw => lower.includes(kw));
}

export default function CommonRejectionReasons({ quotes }) {
  const [expanded, setExpanded] = useState(null);

  const rejected = quotes.filter(q => q.status === "rejected" && q.rejection_reason);

  // Keyword frequency
  const freq = {};
  rejected.forEach(q => {
    extractKeywords(q.rejection_reason).forEach(kw => {
      freq[kw] = (freq[kw] || 0) + 1;
    });
  });

  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Group quotes by top keyword for drill-down
  const grouped = topKeywords.map(([kw, count]) => ({
    keyword: kw,
    count,
    quotes: rejected.filter(q => q.rejection_reason?.toLowerCase().includes(kw)),
  }));

  if (!rejected.length) return <p className="text-sm text-slate-400 py-4">No rejection data yet.</p>;

  return (
    <div className="space-y-2">
      {grouped.map(({ keyword, count, quotes: kqQuotes }) => (
        <div key={keyword} className="border border-slate-200 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
            onClick={() => setExpanded(expanded === keyword ? null : keyword)}
          >
            <span className="flex items-center gap-2">
              <Badge className="bg-red-100 text-red-700 text-xs capitalize">{keyword}</Badge>
              <span className="text-sm text-slate-600">{count} quote{count > 1 ? "s" : ""}</span>
            </span>
            <span className="text-xs text-slate-400">{expanded === keyword ? "▲" : "▼"}</span>
          </button>
          {expanded === keyword && (
            <div className="divide-y divide-slate-100">
              {kqQuotes.slice(0, 5).map(q => (
                <div key={q.id} className="px-4 py-2 text-xs">
                  <span className="font-medium text-slate-700">#{q.quote_number} · {q.site_id}</span>
                  <p className="text-slate-500 mt-0.5 line-clamp-2">{q.rejection_reason}</p>
                </div>
              ))}
              {kqQuotes.length > 5 && (
                <p className="px-4 py-2 text-xs text-slate-400">+{kqQuotes.length - 5} more</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}