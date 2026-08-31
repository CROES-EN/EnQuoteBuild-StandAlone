import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { parseISO, getYear, getQuarter, format } from "date-fns";
import { TrendingUp } from "lucide-react";

function formatCurrency(v) {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(2)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function getQuarterKey(date) {
  return `${getYear(date)} Q${getQuarter(date)}`;
}

export default function QuarterlyRevenueSummary({ quotes }) {
  // Build quarterly buckets
  const buckets = {};
  for (const q of quotes) {
    const d = parseISO(q.created_date);
    const key = getQuarterKey(d);
    if (!buckets[key]) buckets[key] = { key, quoted: 0, invoiced: 0, paid: 0, count: 0 };
    buckets[key].quoted += q.total || 0;
    buckets[key].count += 1;
    if (["invoiced", "invoice_paid", "scheduled", "ho_approved_invoice_required"].includes(q.status)) {
      buckets[key].invoiced += q.total || 0;
    }
  }
  // Paid revenue is bucketed by the manual invoice_paid_date
  for (const q of quotes) {
    if (q.invoice_paid_date) {
      const paidDate = parseISO(q.invoice_paid_date);
      const key = getQuarterKey(paidDate);
      if (!buckets[key]) buckets[key] = { key, quoted: 0, invoiced: 0, paid: 0, count: 0 };
      buckets[key].paid += q.total || 0;
    }
  }

  const data = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);

  const currentKey = getQuarterKey(new Date());
  const currentQ = buckets[currentKey] || { quoted: 0, paid: 0, count: 0 };
  const keys = Object.keys(buckets).sort();
  const prevKey = keys[keys.indexOf(currentKey) - 1];
  const prevQ = prevKey ? buckets[prevKey] : null;
  const qoqChange = prevQ && prevQ.quoted > 0
    ? (((currentQ.quoted - prevQ.quoted) / prevQ.quoted) * 100).toFixed(0)
    : null;

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-slate-900">Quarterly Revenue Summary</h3>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-500">
          <span>This Quarter: <span className="font-semibold text-slate-700">{formatCurrency(currentQ.quoted)}</span></span>
          <span>Paid: <span className="font-semibold text-emerald-700">{formatCurrency(currentQ.paid)}</span></span>
          {qoqChange !== null && (
            <span className={parseInt(qoqChange) >= 0 ? "text-green-600 font-semibold" : "text-rose-600 font-semibold"}>
              {parseInt(qoqChange) >= 0 ? "+" : ""}{qoqChange}% QoQ
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="key" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={formatCurrency} />
          <Tooltip
            contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
            formatter={(v, name) => [formatCurrency(v), name === "quoted" ? "Quoted" : name === "invoiced" ? "Invoiced" : "Paid"]}
          />
          <Bar dataKey="quoted" fill="#a78bfa" radius={[4, 4, 0, 0]} name="quoted" />
          <Bar dataKey="invoiced" fill="#6366f1" radius={[4, 4, 0, 0]} name="invoiced" />
          <Bar dataKey="paid" fill="#10b981" radius={[4, 4, 0, 0]} name="paid" />
        </BarChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-violet-400 inline-block" /> Quoted</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /> Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Paid</span>
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Quarter</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Quotes</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Quoted Value</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Invoiced</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Paid</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Collection Rate</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map(row => (
              <tr key={row.key} className={`border-b border-slate-50 hover:bg-slate-50 ${row.key === currentKey ? "bg-purple-50/40" : ""}`}>
                <td className="py-2.5 px-3 font-semibold text-slate-800">
                  {row.key} {row.key === currentKey && <span className="text-xs font-normal text-purple-600 ml-1">(current)</span>}
                </td>
                <td className="py-2.5 px-3 text-right text-slate-600">{row.count}</td>
                <td className="py-2.5 px-3 text-right font-medium text-slate-800">{formatCurrency(row.quoted)}</td>
                <td className="py-2.5 px-3 text-right text-indigo-700">{formatCurrency(row.invoiced)}</td>
                <td className="py-2.5 px-3 text-right text-emerald-700">{formatCurrency(row.paid)}</td>
                <td className="py-2.5 px-3 text-right">
                  <span className={`font-medium ${row.quoted > 0 && (row.paid / row.quoted) >= 0.7 ? "text-emerald-700" : "text-amber-600"}`}>
                    {row.quoted > 0 ? `${((row.paid / row.quoted) * 100).toFixed(0)}%` : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}