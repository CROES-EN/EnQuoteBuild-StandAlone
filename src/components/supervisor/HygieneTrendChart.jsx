import {useMemo} from "react";
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button} from "@/components/ui/button";
import {useQuoteRequestHygieneHistory} from "@/features/autoDrafter/useQuoteRequestHygieneReport";
import {buildHygieneTrend} from "@/features/supervisorDashboard/supervisorInsights";

const ISSUE_COLORS = ["#f59e0b", "#6366f1", "#0ea5e9", "#10b981"];
const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {month: "short", day: "numeric", timeZone: "UTC"});

export default function HygieneTrendChart() {
  const query = useQuoteRequestHygieneHistory();
  const trend = useMemo(() => buildHygieneTrend(query.data), [query.data]);
  const topIssues = trend.issues.slice(0, ISSUE_COLORS.length);
  const data = trend.rows.map(row => ({...row, label: shortDate(row.date), ...Object.fromEntries(topIssues.map(issue => [issue, row.issues[issue] || 0]))}));
  return <div data-hygiene-trend-chart className="space-y-2">
    <p className="text-xs text-muted-foreground">
      One point per imported report date (the latest import that day). Left axis: flagged-case rate
      {topIssues.length ? `; right axis: cases for the ${topIssues.length === 1 ? "most common flag" : `${topIssues.length} most common flags`}` : ""}.
      {" "}History starts when this version first saw a report, so earlier days are not shown.
    </p>
    {query.isError ? <div role="alert" className="text-sm text-destructive">
      Unable to load hygiene history: {query.error.message} <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
    </div>
      : query.isLoading ? <p role="status" className="text-sm">Loading hygiene history...</p>
      : data.length < 2 ? <p className="text-sm text-muted-foreground">
        {data.length ? `1 day recorded (${data[0].label}: ${data[0].flagged} of ${data[0].requests} flagged, ${data[0].rate}%).` : "No days recorded yet."}
        {" "}The trend appears once reports from at least two different days have been imported.
      </p>
      : <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{left: 0, right: 10, top: 10}}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{fontSize: 11}} />
          <YAxis yAxisId="rate" unit="%" domain={[0, 100]} tick={{fontSize: 11}} />
          <YAxis yAxisId="cases" orientation="right" allowDecimals={false} tick={{fontSize: 11}} />
          <Tooltip formatter={(value, name) => name === "Flagged-case rate" ? [`${value}%`, name] : [value, name]} />
          <Legend wrapperStyle={{fontSize: 12}} />
          <Line yAxisId="rate" dataKey="rate" name="Flagged-case rate" stroke="hsl(var(--primary))" strokeWidth={3} isAnimationActive={false} />
          {topIssues.map((issue, index) => <Line key={issue} yAxisId="cases" dataKey={issue} name={issue}
            stroke={ISSUE_COLORS[index]} strokeDasharray="4 3" dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>}
  </div>;
}
