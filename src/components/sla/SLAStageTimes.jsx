import { Card } from "@/components/ui/card";
import { Clock, ArrowRight } from "lucide-react";
import { differenceInHours, parseISO } from "date-fns";

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function formatHours(h) {
  if (h === null) return "—";
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// Extract time between two status entries from status_history
function extractStageDurations(quotes, fromStatus, toStatus) {
  const durations = [];
  for (const q of quotes) {
    const history = q.status_history || [];
    const fromEntry = history.find(e => e.status === fromStatus);
    const toEntry = history.find(e => e.status === toStatus);
    if (fromEntry && toEntry) {
      const diff = differenceInHours(parseISO(toEntry.changed_at), parseISO(fromEntry.changed_at));
      if (diff >= 0) durations.push(diff);
    }
  }
  return durations;
}

// Fallback using entity-level date fields
function extractByDates(quotes, fromField, toField) {
  const durations = [];
  for (const q of quotes) {
    const from = q[fromField];
    const to = q[toField];
    if (from && to) {
      const diff = differenceInHours(parseISO(to), parseISO(from));
      if (diff >= 0) durations.push(diff);
    }
  }
  return durations;
}

const STAGES = [
  {
    label: "Draft → Submitted",
    description: "Time from quote creation to submission",
    color: "indigo",
    getDurations: (quotes) => {
      // Use created_date → submitted_date for most accurate measure
      const fromDate = extractByDates(quotes, "created_date", "submitted_date");
      if (fromDate.length > 0) return fromDate;
      return extractStageDurations(quotes, "draft_without_fst", "submitted")
        .concat(extractStageDurations(quotes, "draft_without_internal", "submitted"));
    }
  },
  {
    label: "Submitted → Approved",
    description: "Time from submission to internal approval",
    color: "emerald",
    getDurations: (quotes) => {
      const fromDate = extractByDates(quotes, "submitted_date", "approved_date");
      if (fromDate.length > 0) return fromDate;
      return extractStageDurations(quotes, "submitted", "approved");
    }
  },
  {
    label: "Approved → Sent to HO",
    description: "Time from approval to sending quote to HO",
    color: "purple",
    getDurations: (quotes) => {
      const fromDate = extractByDates(quotes, "approved_date", "quote_sent_to_ho_date");
      if (fromDate.length > 0) return fromDate;
      return extractStageDurations(quotes, "approved", "quote_sent_to_ho");
    }
  },
  {
    label: "HO Approved → Invoiced",
    description: "Time from HO approval to invoice creation",
    color: "amber",
    getDurations: (quotes) => {
      const fromDate = extractByDates(quotes, "ho_approved_date", "invoiced_date");
      if (fromDate.length > 0) return fromDate;
      return extractStageDurations(quotes, "ho_approved_invoice_required", "invoiced");
    }
  },
  {
    label: "Invoiced → Paid",
    description: "Time from invoice creation to payment",
    color: "green",
    getDurations: (quotes) => {
      const fromDate = extractByDates(quotes, "invoiced_date", "invoice_paid_date");
      if (fromDate.length > 0) return fromDate;
      return extractStageDurations(quotes, "invoiced", "invoice_paid");
    }
  },
];

const COLOR_MAP = {
  indigo: { bg: "bg-indigo-50", icon: "text-indigo-500", value: "text-indigo-700", bar: "bg-indigo-400", badge: "bg-indigo-100 text-indigo-700" },
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-500", value: "text-emerald-700", bar: "bg-emerald-400", badge: "bg-emerald-100 text-emerald-700" },
  purple: { bg: "bg-purple-50", icon: "text-purple-500", value: "text-purple-700", bar: "bg-purple-400", badge: "bg-purple-100 text-purple-700" },
  amber: { bg: "bg-amber-50", icon: "text-amber-500", value: "text-amber-700", bar: "bg-amber-400", badge: "bg-amber-100 text-amber-700" },
  green: { bg: "bg-green-50", icon: "text-green-500", value: "text-green-700", bar: "bg-green-400", badge: "bg-green-100 text-green-700" },
};

export default function SLAStageTimes({ quotes }) {
  const stageData = STAGES.map(stage => {
    const durations = stage.getDurations(quotes);
    const avgH = avg(durations);
    const minH = durations.length ? Math.min(...durations) : null;
    const maxH = durations.length ? Math.max(...durations) : null;
    return { ...stage, durations, avgH, minH, maxH, n: durations.length };
  });

  const maxAvg = Math.max(...stageData.map(s => s.avgH || 0), 1);

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center gap-2 mb-6">
        <Clock className="w-5 h-5 text-slate-600" />
        <h3 className="text-lg font-semibold text-slate-900">SLA Stage Times</h3>
        <span className="text-xs text-slate-400 ml-1">(avg time per lifecycle stage)</span>
      </div>

      <div className="space-y-5">
        {stageData.map((stage, i) => {
          const c = COLOR_MAP[stage.color];
          const barWidth = stage.avgH ? Math.max((stage.avgH / maxAvg) * 100, 4) : 0;

          return (
            <div key={i} className={`rounded-xl p-4 ${c.bg}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ArrowRight className={`w-4 h-4 ${c.icon}`} />
                    <p className="font-semibold text-slate-800">{stage.label}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>
                      {stage.n} quotes
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 ml-6">{stage.description}</p>
                </div>
                <div className="flex items-baseline gap-3 sm:text-right">
                  <div>
                    <p className="text-xs text-slate-500">Avg</p>
                    <p className={`text-2xl font-bold ${c.value}`}>{formatHours(stage.avgH)}</p>
                  </div>
                  {stage.minH !== null && (
                    <div>
                      <p className="text-xs text-slate-500">Min</p>
                      <p className="text-sm font-medium text-slate-600">{formatHours(stage.minH)}</p>
                    </div>
                  )}
                  {stage.maxH !== null && (
                    <div>
                      <p className="text-xs text-slate-500">Max</p>
                      <p className="text-sm font-medium text-slate-600">{formatHours(stage.maxH)}</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="w-full bg-white/60 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${c.bar}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}