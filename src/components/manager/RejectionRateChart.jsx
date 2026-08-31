import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function RejectionRateChart({ quotes }) {
  // Group by submitter (who moved quote to "submitted")
  const submitterMap = {};

  quotes.forEach(q => {
    const submitter = q.status_history?.find(h => h.status === "submitted")?.changed_by
      || q.status_history?.[0]?.changed_by
      || "Unknown";
    const name = submitter.split("@")[0];
    if (!submitterMap[name]) submitterMap[name] = { name, submitted: 0, approved: 0, rejected: 0 };
    submitterMap[name].submitted++;
    if (["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid", "scheduled"].includes(q.status)) {
      submitterMap[name].approved++;
    }
    if (q.status === "rejected" || q.status === "ho_rejected") {
      submitterMap[name].rejected++;
    }
  });

  const data = Object.values(submitterMap)
    .filter(d => d.submitted >= 2)
    .map(d => ({
      ...d,
      rejectionRate: d.submitted > 0 ? Math.round((d.rejected / d.submitted) * 100) : 0,
    }))
    .sort((a, b) => b.rejectionRate - a.rejectionRate);

  if (!data.length) return <p className="text-sm text-slate-400 py-4">Not enough data yet.</p>;

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis unit="%" tick={{ fontSize: 12 }} domain={[0, 100]} />
          <Tooltip formatter={(v) => `${v}%`} />
          <Bar dataKey="rejectionRate" name="Rejection Rate" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.rejectionRate >= 40 ? "#ef4444" : entry.rejectionRate >= 20 ? "#f97316" : "#22c55e"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.map(d => (
          <div key={d.name} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
            <p className="font-semibold text-slate-700">{d.name}</p>
            <p className="text-slate-500">{d.submitted} submitted · {d.rejected} rejected</p>
          </div>
        ))}
      </div>
    </div>
  );
}