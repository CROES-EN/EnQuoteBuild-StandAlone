import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from "recharts";
import { Activity } from "lucide-react";
import { formatDateLabel } from "@/features/supervisorDashboard/format";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Up to `windowSize` preceding *valid stored records* for this metric - never calendar days. */
function rollingAverageByDate(entries, windowSize = 7) {
  const valid = entries.filter(entry => isFiniteNumber(entry.value));
  const byDate = new Map();
  valid.forEach((entry, idx) => {
    const windowSlice = valid.slice(Math.max(0, idx - windowSize + 1), idx + 1);
    const avg = windowSlice.reduce((sum, e) => sum + e.value, 0) / windowSlice.length;
    byDate.set(entry.date, avg);
  });
  return byDate;
}

function ChartCard({ title, children, action, emptyMessage }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>
        {children || (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Activity className="w-8 h-8" />
            <p className="text-sm">{emptyMessage || "No data yet for this range."}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CONTACT_CENTER_METRICS = [
  { key: "calls_offered", label: "Calls Offered", color: "#6366f1" },
  { key: "calls", label: "Calls Handled", color: "#0ea5e9" },
  { key: "calls_abandoned", label: "Calls Abandoned", color: "#f43f5e" }
];

/**
 * Calls Offered/Handled/Abandoned over the selected range, with a Daily Values / Seven-Record
 * Rolling Average toggle. The rolling average uses up to 7 *preceding valid stored records* for
 * each metric independently, per spec - never a 7-calendar-day window, since missing dates stay
 * missing rather than being silently interpolated across.
 */
export function ContactCenterHistoryChart({ records = [] }) {
  const [mode, setMode] = useState("daily");

  const chartData = useMemo(() => {
    const rollingByMetric = Object.fromEntries(
      CONTACT_CENTER_METRICS.map(metric => [
        metric.key,
        rollingAverageByDate(records.map(r => ({ date: r.date, value: r[metric.key] })))
      ])
    );
    return records.map(record => {
      const row = { date: formatDateLabel(record.date), rawDate: record.date };
      CONTACT_CENTER_METRICS.forEach(metric => {
        row[metric.key] = isFiniteNumber(record[metric.key]) ? record[metric.key] : null;
        row[`${metric.key}_rolling`] = rollingByMetric[metric.key].has(record.date)
          ? Math.round(rollingByMetric[metric.key].get(record.date) * 10) / 10
          : null;
      });
      return row;
    });
  }, [records]);

  const hasAnyData = chartData.some(row => CONTACT_CENTER_METRICS.some(metric => row[metric.key] !== null));
  const suffix = mode === "rolling" ? "_rolling" : "";

  return (
    <ChartCard
      title="Contact Center Volume"
      emptyMessage="No Contact Center data yet for this range."
      action={
        <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && setMode(v)}>
          <ToggleGroupItem value="daily" aria-label="Daily values">Daily Values</ToggleGroupItem>
          <ToggleGroupItem value="rolling" aria-label="Seven-record rolling average">Seven-Record Rolling Average</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {hasAnyData && (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {CONTACT_CENTER_METRICS.map(metric => (
              <Line
                key={metric.key}
                type="monotone"
                dataKey={`${metric.key}${suffix}`}
                stroke={metric.color}
                strokeWidth={2}
                dot={mode === "daily" ? { r: 2 } : false}
                connectNulls={false}
                name={metric.label}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/**
 * Quotes Received (from the Salesforce import field)/Drafted/Completed as bars, plus an ending
 * Quote Backlog line - `quoteOpsSeries` is the live-computed per-date figures from
 * quoteOpsMetrics.js (never stored, so this chart never fabricates or duplicates that data).
 * The backlog line is only rendered once at least two valid backlog observations exist in range.
 */
export function QuoteOperationsHistoryChart({ records = [], quoteOpsSeries = [] }) {
  const chartData = useMemo(() => {
    const seriesByDate = new Map(quoteOpsSeries.map(entry => [entry.date, entry]));
    return records.map(record => {
      const computed = seriesByDate.get(record.date);
      return {
        date: formatDateLabel(record.date),
        quotes_received: isFiniteNumber(record.sf_quotes_received) ? record.sf_quotes_received : null,
        quotes_drafted: isFiniteNumber(computed?.quotesDrafted) ? computed.quotesDrafted : null,
        quotes_completed: isFiniteNumber(computed?.quotesCompleted) ? computed.quotesCompleted : null,
        backlog_end: isFiniteNumber(computed?.backlogEnd) ? computed.backlogEnd : null
      };
    });
  }, [records, quoteOpsSeries]);

  const validBacklogCount = chartData.filter(row => row.backlog_end !== null).length;
  const showBacklogLine = validBacklogCount >= 2;
  const hasAnyData = chartData.some(row => row.quotes_received !== null || row.quotes_drafted !== null || row.quotes_completed !== null);

  return (
    <ChartCard title="Quote Activity & Backlog" emptyMessage="No Quote Operations data yet for this range.">
      {hasAnyData && (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="volume" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            {showBacklogLine && (
              <YAxis yAxisId="backlog" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            )}
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="volume" dataKey="quotes_received" fill="#a5b4fc" radius={[4, 4, 0, 0]} name="Quotes Received" />
            <Bar yAxisId="volume" dataKey="quotes_drafted" fill="#6366f1" radius={[4, 4, 0, 0]} name="Quotes Drafted" />
            <Bar yAxisId="volume" dataKey="quotes_completed" fill="#059669" radius={[4, 4, 0, 0]} name="Quotes Completed" />
            {showBacklogLine && (
              <Line yAxisId="backlog" type="monotone" dataKey="backlog_end" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Quote Backlog at End" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {!showBacklogLine && hasAnyData && (
        <p className="mt-2 text-xs text-muted-foreground">
          Quote Backlog at End trend line requires at least two days with a computable backlog in this range.
        </p>
      )}
    </ChartCard>
  );
}

export default function ExecutiveOverviewCharts({ records = [], quoteOpsSeries = [] }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <QuoteOperationsHistoryChart records={records} quoteOpsSeries={quoteOpsSeries} />
      <ContactCenterHistoryChart records={records} />
    </div>
  );
}
