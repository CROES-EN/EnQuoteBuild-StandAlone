import {useMemo, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Activity} from "lucide-react";
import {formatDateLabel, formatSecondsAsClock} from "@/features/supervisorDashboard/format";

const RANGE_OPTIONS = [
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" }
];

function ChartCard({ title, children }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          {children}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function MetricsTrendCharts({ records }) {
  const [range, setRange] = useState("30");

  const chartData = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const sliced = range === "all" ? sorted : sorted.slice(-Number(range));
    return sliced.map(record => ({
      date: formatDateLabel(record.date),
      calls: record.calls,
      ahtMinutes: record.aht_seconds !== null && record.aht_seconds !== undefined
        ? Math.round((record.aht_seconds / 60) * 10) / 10
        : null,
      aht_seconds: record.aht_seconds,
      emails_worked: record.emails_worked,
      quotes_drafted: record.quotes_drafted,
      staffing_present: record.staffing_present
    }));
  }, [records, range]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Calls & Average Handle Time">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="calls" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="aht" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
              formatter={(value, name, item) => {
                if (name === "AHT") return [formatSecondsAsClock(item.payload.aht_seconds), "AHT"];
                return [value, "Calls"];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="calls" dataKey="calls" fill="#6366f1" radius={[4, 4, 0, 0]} name="Calls" />
            <Line yAxisId="aht" type="monotone" dataKey="ahtMinutes" stroke="#f59e0b" strokeWidth={2} dot={false} name="AHT" />
          </ComposedChart>
        </ChartCard>

        <ChartCard title="Emails Worked & Quotes Drafted">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="emails_worked" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Emails Worked" />
            <Bar dataKey="quotes_drafted" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Quotes Drafted" />
          </ComposedChart>
        </ChartCard>

        <ChartCard title="Staffing">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="staffing_present" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Staffing" />
          </ComposedChart>
        </ChartCard>
      </div>

      {chartData.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <Activity className="w-8 h-8" />
          <p className="text-sm">No data yet for this range.</p>
        </div>
      )}
    </div>
  );
}
