import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell
} from "recharts";
import { format, startOfWeek, differenceInHours, differenceInDays, parseISO, isValid, subWeeks } from "date-fns";
import { User, TrendingUp, Clock, AlertCircle, DollarSign, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt$ = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
const fmtHr = (h) => h == null ? "—" : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;

const STATUS_STAGES = [
  { key: "draft_to_submitted", label: "Draft → Submitted", fromKey: "created_date", toStatus: "submitted" },
  { key: "submitted_to_approved", label: "Submitted → Approved", fromStatus: "submitted", toStatus: "approved" },
  { key: "approved_to_sent_ho", label: "Approved → Sent HO", fromStatus: "approved", toStatus: "quote_sent_to_ho" },
  { key: "sent_ho_to_invoiced", label: "Sent HO → Invoiced", fromStatus: "ho_approved_invoice_required", toStatus: "invoiced" },
];

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#3b82f6", "#84cc16"
];

function getStatusDate(quote, status) {
  if (status === "created_date") return quote.created_date ? new Date(quote.created_date) : null;
  const hist = quote.status_history;
  if (!hist?.length) {
    // fallback to top-level date fields
    const fallbacks = {
      submitted: quote.submitted_date,
      approved: quote.approved_date,
      quote_sent_to_ho: quote.quote_sent_to_ho_date,
      ho_approved_invoice_required: quote.ho_approved_date,
      invoiced: quote.invoiced_date,
      invoice_paid: quote.invoice_paid_date,
    };
    const v = fallbacks[status];
    return v ? new Date(v) : null;
  }
  const entry = [...hist].reverse().find(h => h.status === status);
  return entry?.changed_at ? new Date(entry.changed_at) : null;
}

function getWeekKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return format(startOfWeek(d, { weekStartsOn: 1 }), "MMM d");
}

function getQuarterKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}`;
}

function computeCoordStats(quotes) {
  const byCoord = {};
  for (const q of quotes) {
    const coord = q.created_by || "Unknown";
    if (!byCoord[coord]) byCoord[coord] = { coord, quotes: [] };
    byCoord[coord].quotes.push(q);
  }

  return Object.values(byCoord).map(({ coord, quotes }) => {
    const total = quotes.length;
    const submitted = quotes.filter(q => q.status !== "draft_without_internal" && q.status !== "draft_without_fst").length;
    const approved = quotes.filter(q =>
      ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(q.status)
    ).length;
    const rejected = quotes.filter(q => ["rejected", "ho_rejected"].includes(q.status)).length;
    const invoiced = quotes.filter(q => ["invoiced", "invoice_paid", "scheduled"].includes(q.status)).length;
    const paid = quotes.filter(q => ["invoice_paid", "scheduled"].includes(q.status)).length;

    const totalQuoted = quotes.reduce((s, q) => s + (q.total || 0), 0);
    const totalInvoiced = invoiced > 0
      ? quotes.filter(q => ["invoiced", "invoice_paid", "scheduled"].includes(q.status)).reduce((s, q) => s + (q.total || 0), 0)
      : 0;
    const totalCollected = quotes.filter(q => ["invoice_paid", "scheduled"].includes(q.status)).reduce((s, q) => s + (q.total || 0), 0);
    const approvalRate = submitted > 0 ? ((approved / submitted) * 100).toFixed(0) : "—";

    // Stage timings
    const stageTimes = {};
    for (const stage of STATUS_STAGES) {
      const durations = [];
      for (const q of quotes) {
        const fromDate = stage.fromKey
          ? getStatusDate(q, stage.fromKey)
          : getStatusDate(q, stage.fromStatus);
        const toDate = getStatusDate(q, stage.toStatus);
        if (fromDate && toDate && toDate > fromDate) {
          durations.push(differenceInHours(toDate, fromDate));
        }
      }
      stageTimes[stage.key] = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;
    }

    // Stuck quotes (>3 days in current non-terminal status)
    const terminalStatuses = ["invoice_paid", "scheduled", "ho_rejected", "rejected"];
    const stuck = quotes.filter(q => {
      if (terminalStatuses.includes(q.status)) return false;
      const lastChange = q.status_history?.length
        ? new Date(q.status_history[q.status_history.length - 1].changed_at)
        : new Date(q.created_date);
      return differenceInDays(new Date(), lastChange) >= 3;
    }).length;

    return {
      coord,
      total,
      submitted,
      approved,
      rejected,
      invoiced,
      paid,
      totalQuoted,
      totalInvoiced,
      totalCollected,
      approvalRate,
      stageTimes,
      stuck,
      quotes,
    };
  }).sort((a, b) => b.totalQuoted - a.totalQuoted);
}

function WeekOverWeekChart({ quotes, selectedCoord }) {
  const data = useMemo(() => {
    const coordQuotes = selectedCoord === "all"
      ? quotes
      : quotes.filter(q => q.created_by === selectedCoord);

    const weekMap = {};
    for (const q of coordQuotes) {
      if (!q.created_date) continue;
      const wk = getWeekKey(q.created_date);
      if (!weekMap[wk]) weekMap[wk] = { week: wk, quotes: 0, revenue: 0, approved: 0 };
      weekMap[wk].quotes++;
      weekMap[wk].revenue += q.total || 0;
      if (["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(q.status)) {
        weekMap[wk].approved++;
      }
    }

    return Object.values(weekMap)
      .sort((a, b) => new Date(a.week) - new Date(b.week))
      .slice(-12);
  }, [quotes, selectedCoord]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-700">Week-over-Week: Quotes Created & Approved</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="quotes" name="Quotes Created" fill="#6366f1" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="left" dataKey="approved" name="Approved" fill="#10b981" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function RevenueWoWChart({ quotes, selectedCoord }) {
  const data = useMemo(() => {
    const coordQuotes = selectedCoord === "all"
      ? quotes
      : quotes.filter(q => q.created_by === selectedCoord);

    const weekMap = {};
    for (const q of coordQuotes) {
      if (!q.created_date) continue;
      const wk = getWeekKey(q.created_date);
      if (!weekMap[wk]) weekMap[wk] = { week: wk, quoted: 0, invoiced: 0, collected: 0 };
      weekMap[wk].quoted += q.total || 0;
      if (["invoiced", "invoice_paid", "scheduled"].includes(q.status)) weekMap[wk].invoiced += q.total || 0;
      if (["invoice_paid", "scheduled"].includes(q.status)) weekMap[wk].collected += q.total || 0;
    }

    return Object.values(weekMap)
      .sort((a, b) => new Date(a.week) - new Date(b.week))
      .slice(-12)
      .map(w => ({ ...w, quoted: w.quoted / 1000, invoiced: w.invoiced / 1000, collected: w.collected / 1000 }));
  }, [quotes, selectedCoord]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-700">Week-over-Week: Revenue ($k)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}k`} />
            <Tooltip formatter={(v) => [`$${v.toFixed(1)}k`]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="quoted" name="Quoted" stroke="#6366f1" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="collected" name="Collected" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function QuarterlyCoordTable({ quotes }) {
  const data = useMemo(() => {
    const map = {}; // quarter → coord → { ... }
    for (const q of quotes) {
      if (!q.created_date) continue;
      const qk = getQuarterKey(q.created_date);
      const coord = q.created_by || "Unknown";
      if (!map[qk]) map[qk] = {};
      if (!map[qk][coord]) map[qk][coord] = { total: 0, approved: 0, rejected: 0, quoted: 0, collected: 0 };
      map[qk][coord].total++;
      map[qk][coord].quoted += q.total || 0;
      if (["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(q.status)) map[qk][coord].approved++;
      if (["rejected", "ho_rejected"].includes(q.status)) map[qk][coord].rejected++;
      if (["invoice_paid", "scheduled"].includes(q.status)) map[qk][coord].collected += q.total || 0;
    }

    const quarters = Object.keys(map).sort((a, b) => {
      const [qa, ya] = a.split(" "); const [qb, yb] = b.split(" ");
      return ya !== yb ? parseInt(yb) - parseInt(ya) : parseInt(qb.slice(1)) - parseInt(qa.slice(1));
    });

    return quarters.map(qk => ({
      quarter: qk,
      coords: Object.entries(map[qk])
        .map(([coord, stats]) => ({ coord, ...stats }))
        .sort((a, b) => b.quoted - a.quoted)
    }));
  }, [quotes]);

  return (
    <div className="space-y-6">
      {data.map(({ quarter, coords }) => (
        <Card key={quarter}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">{quarter}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Coordinator</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Quotes</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Approved</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Rejected</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Rate</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Quoted</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {coords.map(({ coord, total, approved, rejected, quoted, collected }) => (
                    <tr key={coord} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{coord}</td>
                      <td className="text-center px-3 py-2.5 text-slate-600">{total}</td>
                      <td className="text-center px-3 py-2.5 text-emerald-700 font-medium">{approved}</td>
                      <td className="text-center px-3 py-2.5 text-rose-600">{rejected}</td>
                      <td className="text-center px-3 py-2.5">
                        <Badge className={cn("text-xs border-0", total > 0 && approved / total >= 0.7
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700")}>
                          {total > 0 ? `${((approved / total) * 100).toFixed(0)}%` : "—"}
                        </Badge>
                      </td>
                      <td className="text-right px-4 py-2.5 font-semibold text-slate-800">{fmt$(quoted)}</td>
                      <td className="text-right px-4 py-2.5 text-emerald-700 font-semibold">{fmt$(collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StagePill({ hours, warnAt = 48, redAt = 120 }) {
  if (hours == null) return <span className="text-slate-400 text-xs">—</span>;
  const color = hours >= redAt
    ? "bg-red-100 text-red-700"
    : hours >= warnAt
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return <Badge className={cn("text-xs border-0", color)}>{fmtHr(hours)}</Badge>;
}

function CoordDetailRow({ stat, isSelected, onClick, color }) {
  return (
    <tr
      className={cn("border-b border-slate-100 cursor-pointer transition-colors", isSelected ? "bg-indigo-50" : "hover:bg-slate-50")}
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium text-slate-800 text-sm truncate max-w-[180px]">{stat.coord}</span>
        </div>
      </td>
      <td className="text-center px-3 py-3 text-sm text-slate-600">{stat.total}</td>
      <td className="text-center px-3 py-3 text-sm">
        <Badge className={cn("border-0 text-xs", parseInt(stat.approvalRate) >= 70 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
          {stat.approvalRate}{stat.approvalRate !== "—" ? "%" : ""}
        </Badge>
      </td>
      <td className="text-center px-3 py-3 text-sm text-rose-600">{stat.rejected}</td>
      <td className="text-right px-3 py-3 text-sm font-semibold text-slate-800">{fmt$(stat.totalQuoted)}</td>
      <td className="text-right px-3 py-3 text-sm text-emerald-700 font-semibold">{fmt$(stat.totalCollected)}</td>
      <td className="text-center px-3 py-3">
        <StagePill hours={stat.stageTimes.draft_to_submitted} warnAt={48} redAt={120} />
      </td>
      <td className="text-center px-3 py-3">
        <StagePill hours={stat.stageTimes.submitted_to_approved} warnAt={72} redAt={168} />
      </td>
      <td className="text-center px-3 py-3">
        {stat.stuck > 0
          ? <Badge className="bg-red-100 text-red-700 border-0 text-xs">{stat.stuck} stuck</Badge>
          : <span className="text-xs text-slate-400">—</span>}
      </td>
    </tr>
  );
}

export default function CoordinatorBreakdown({ quotes }) {
  const [selectedCoord, setSelectedCoord] = useState("all");

  const stats = useMemo(() => computeCoordStats(quotes), [quotes]);
  const coordinators = stats.map(s => s.coord);

  const selectedStats = selectedCoord === "all"
    ? null
    : stats.find(s => s.coord === selectedCoord);

  // Bar chart: revenue by coordinator
  const revenueBarData = stats.slice(0, 10).map((s, i) => ({
    name: s.coord.split("@")[0],
    quoted: +(s.totalQuoted / 1000).toFixed(1),
    collected: +(s.totalCollected / 1000).toFixed(1),
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* Top Revenue Bar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-indigo-500" />
            Revenue Contribution by Coordinator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueBarData} layout="vertical" barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v) => [`$${v}k`]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="quoted" name="Quoted" fill="#6366f1" radius={[0, 3, 3, 0]}>
                {revenueBarData.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} opacity={0.7} />)}
              </Bar>
              <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[0, 3, 3, 0]}>
                {revenueBarData.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Coordinator Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <User className="w-4 h-4 text-indigo-500" />
            Per-Coordinator Breakdown (click row to focus charts)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Coordinator</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Quotes</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Approval %</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Rejected</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Quoted</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Collected</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Draft→Submit</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Submit→Approve</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">Gaps</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat, i) => (
                  <CoordDetailRow
                    key={stat.coord}
                    stat={stat}
                    isSelected={selectedCoord === stat.coord}
                    onClick={() => setSelectedCoord(prev => prev === stat.coord ? "all" : stat.coord)}
                    color={COLORS[i % COLORS.length]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* WoW Charts */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-500" />
          Week-over-Week Trends
        </h3>
        <Select value={selectedCoord} onValueChange={setSelectedCoord}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Coordinators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Coordinators</SelectItem>
            {coordinators.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WeekOverWeekChart quotes={quotes} selectedCoord={selectedCoord} />
        <RevenueWoWChart quotes={quotes} selectedCoord={selectedCoord} />
      </div>

      {/* Quarterly Breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-indigo-500" />
          Quarterly Coordinator Summary
        </h3>
        <QuarterlyCoordTable quotes={quotes} />
      </div>
    </div>
  );
}