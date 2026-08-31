import { Card } from "@/components/ui/card";
import { parseISO, getYear, getQuarter, differenceInHours } from "date-fns";
import { Clock } from "lucide-react";

function getQuarterKey(date) {
  return `${getYear(date)} Q${getQuarter(date)}`;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function formatHours(h) {
  if (h === null) return "—";
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function extractDuration(q, fromField, toField) {
  const from = q[fromField];
  const to = q[toField];
  if (!from || !to) return null;
  const diff = differenceInHours(parseISO(to), parseISO(from));
  return diff >= 0 ? diff : null;
}

export default function QuarterlySLASummary({ quotes }) {
  const buckets = {};

  for (const q of quotes) {
    const d = parseISO(q.created_date);
    const key = getQuarterKey(d);
    if (!buckets[key]) {
      buckets[key] = {
        key,
        count: 0,
        submitted: 0, submittedN: 0,
        approved: 0, approvedN: 0,
        sentToHo: 0, sentToHoN: 0,
        invoiced: 0, invoicedN: 0,
        paid: 0, paidN: 0,
        rejectedCount: 0,
        hoRejectedCount: 0,
        paidCount: 0,
      };
    }
    const b = buckets[key];
    b.count += 1;

    const d1 = extractDuration(q, "created_date", "submitted_date");
    if (d1 !== null) { b.submitted += d1; b.submittedN++; }

    const d2 = extractDuration(q, "submitted_date", "approved_date");
    if (d2 !== null) { b.approved += d2; b.approvedN++; }

    const d3 = extractDuration(q, "approved_date", "quote_sent_to_ho_date");
    if (d3 !== null) { b.sentToHo += d3; b.sentToHoN++; }

    const d4 = extractDuration(q, "ho_approved_date", "invoiced_date");
    if (d4 !== null) { b.invoiced += d4; b.invoicedN++; }

    const d5 = extractDuration(q, "invoiced_date", "invoice_paid_date");
    if (d5 !== null) { b.paid += d5; b.paidN++; }

    if (q.status === "rejected") b.rejectedCount++;
    if (q.status === "ho_rejected") b.hoRejectedCount++;
    if (["invoice_paid", "scheduled"].includes(q.status)) b.paidCount++;
  }

  const rows = Object.values(buckets).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 8);
  const currentKey = getQuarterKey(new Date());

  const cols = [
    { label: "Draft → Submit", fn: r => r.submittedN > 0 ? r.submitted / r.submittedN : null },
    { label: "Submit → Approve", fn: r => r.approvedN > 0 ? r.approved / r.approvedN : null },
    { label: "Approve → HO", fn: r => r.sentToHoN > 0 ? r.sentToHo / r.sentToHoN : null },
    { label: "HO Appr → Invoice", fn: r => r.invoicedN > 0 ? r.invoiced / r.invoicedN : null },
    { label: "Invoice → Paid", fn: r => r.paidN > 0 ? r.paid / r.paidN : null },
  ];

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center gap-2 mb-5">
        <Clock className="w-5 h-5 text-indigo-600" />
        <h3 className="text-lg font-semibold text-slate-900">Quarterly SLA Summary</h3>
        <span className="text-xs text-slate-400">(avg stage times per quarter)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Quarter</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Quotes</th>
              {cols.map(c => (
                <th key={c.label} className="text-right py-2 px-3 text-xs font-medium text-slate-500 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Rejected</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className={`border-b border-slate-50 hover:bg-slate-50 ${row.key === currentKey ? "bg-indigo-50/40" : ""}`}>
                <td className="py-2.5 px-3 font-semibold text-slate-800">
                  {row.key}
                  {row.key === currentKey && <span className="text-xs font-normal text-indigo-600 ml-1">(current)</span>}
                </td>
                <td className="py-2.5 px-3 text-right text-slate-600">{row.count}</td>
                {cols.map(c => {
                  const val = c.fn(row);
                  return (
                    <td key={c.label} className="py-2.5 px-3 text-right font-medium text-slate-700">
                      {formatHours(val)}
                    </td>
                  );
                })}
                <td className="py-2.5 px-3 text-right">
                  <span className={row.rejectedCount + row.hoRejectedCount > 0 ? "text-rose-600 font-medium" : "text-slate-400"}>
                    {row.rejectedCount + row.hoRejectedCount}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className="text-emerald-700 font-medium">{row.paidCount}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}