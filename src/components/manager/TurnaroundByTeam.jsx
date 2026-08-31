import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  return ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24) * 10) / 10 : null;
}

function avg(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined);
  if (!valid.length) return null;
  return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
}

export default function TurnaroundByTeam({ quotes }) {
  const submitterMap = {};

  quotes.forEach(q => {
    const submitter = q.status_history?.find(h => h.status === "submitted")?.changed_by
      || q.status_history?.[0]?.changed_by
      || "Unknown";
    const name = submitter.split("@")[0];
    if (!submitterMap[name]) submitterMap[name] = { name, draftToSubmit: [], submitToDecision: [], total: [] };

    const createdAt = q.created_date;
    const submittedAt = q.submitted_date;
    const decisionAt = q.approved_date || q.ho_approved_date
      || q.status_history?.find(h => h.status === "rejected")?.changed_at;

    const d2s = daysBetween(createdAt, submittedAt);
    const s2d = daysBetween(submittedAt, decisionAt);
    const total = daysBetween(createdAt, decisionAt);

    if (d2s !== null) submitterMap[name].draftToSubmit.push(d2s);
    if (s2d !== null) submitterMap[name].submitToDecision.push(s2d);
    if (total !== null) submitterMap[name].total.push(total);
  });

  const data = Object.values(submitterMap)
    .filter(d => d.total.length >= 2)
    .map(d => ({
      name: d.name,
      "Draft → Submit": avg(d.draftToSubmit),
      "Submit → Decision": avg(d.submitToDecision),
      "Total Cycle": avg(d.total),
    }))
    .sort((a, b) => (b["Total Cycle"] || 0) - (a["Total Cycle"] || 0));

  if (!data.length) return <p className="text-sm text-slate-400 py-4">Not enough data for turnaround analysis yet.</p>;

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis unit="d" tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => v !== null ? `${v} days` : "—"} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Draft → Submit" fill="#94a3b8" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Submit → Decision" fill="#f97316" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Total Cycle" fill="#6366f1" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-2">
        Longer "Draft → Submit" times may indicate hesitation or gaps in quote building skills.
        Longer "Submit → Decision" times may indicate review bottlenecks.
      </p>
    </div>
  );
}