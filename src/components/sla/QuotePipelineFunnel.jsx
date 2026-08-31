import { Card } from "@/components/ui/card";
import { getYear, getQuarter, parseISO } from "date-fns";
import { ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

function formatCurrency(v) {
  if (!v) return "$0";
  if (v >= 1000000) return `$${(v / 1000000).toFixed(2)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function getQuarterKey(date) {
  return `${getYear(date)} Q${getQuarter(date)}`;
}

function ConversionBadge({ rate, label }) {
  const pct = Math.round(rate * 100);
  const isGood = pct >= 60;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <ArrowRight className="w-4 h-4 text-slate-300" />
      <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded-full", isGood ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
        {pct}%
      </span>
      <span className="text-xs text-slate-400 whitespace-nowrap">{label}</span>
    </div>
  );
}

function FunnelStage({ label, count, value, color, sublabel }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-3 py-4 rounded-xl border-2 min-w-[110px]", color)}>
      <p className="text-xs font-medium text-slate-500 mb-1 leading-tight">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{count}</p>
      {value > 0 && <p className="text-sm font-semibold text-slate-600 mt-0.5">{formatCurrency(value)}</p>}
      {sublabel && <p className="text-xs text-slate-400 mt-1">{sublabel}</p>}
    </div>
  );
}

export default function QuotePipelineFunnel({ quotes }) {
  const currentKey = getQuarterKey(new Date());

  // Build per-quarter data
  const quarters = {};
  for (const q of quotes) {
    const key = getQuarterKey(parseISO(q.created_date));
    if (!quarters[key]) quarters[key] = [];
    quarters[key].push(q);
  }

  const allKeys = Object.keys(quarters).sort();
  // Show last 4 quarters
  const displayKeys = allKeys.slice(-4);

  const computeMetrics = (qs) => {
    const created = qs.length;
    const createdVal = qs.reduce((s, q) => s + (q.total || 0), 0);

    const approved = qs.filter(q => ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "ho_rejected", "invoiced", "invoice_paid", "scheduled"].includes(q.status));
    const approvedVal = approved.reduce((s, q) => s + (q.total || 0), 0);

    const hoRejected = qs.filter(q => q.status === "ho_rejected");
    const hoRejectedVal = hoRejected.reduce((s, q) => s + (q.total || 0), 0);

    const invoiced = qs.filter(q => ["invoiced", "invoice_paid", "scheduled"].includes(q.status));
    const invoicedVal = invoiced.reduce((s, q) => s + (q.total || 0), 0);

    const paid = qs.filter(q => ["invoice_paid", "scheduled"].includes(q.status));
    const paidVal = paid.reduce((s, q) => s + (q.total || 0), 0);

    return {
      created, createdVal,
      approved: approved.length, approvedVal,
      hoRejected: hoRejected.length, hoRejectedVal,
      invoiced: invoiced.length, invoicedVal,
      paid: paid.length, paidVal,
    };
  };

  // Current quarter metrics for the funnel view
  const currentQs = quarters[currentKey] || [];
  const m = computeMetrics(currentQs);

  // Approval rate from invoiced → paid
  const invoicedToPaid = m.invoiced > 0 ? m.paid / m.invoiced : 0;
  const approvedToInvoiced = m.approved > 0 ? m.invoiced / m.approved : 0;
  const createdToApproved = m.created > 0 ? m.approved / m.created : 0;

  return (
    <Card className="p-6 border-slate-200">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="w-5 h-5 text-indigo-600" />
        <h3 className="text-lg font-semibold text-slate-900">Quote Pipeline Funnel</h3>
        <span className="ml-auto text-sm text-slate-500 font-medium">{currentKey} <span className="text-indigo-500">(current quarter)</span></span>
      </div>

      {/* Funnel */}
      <div className="flex flex-wrap items-center gap-2 mb-8 overflow-x-auto pb-2">
        <FunnelStage
          label="Created"
          count={m.created}
          value={m.createdVal}
          color="border-slate-200 bg-slate-50"
        />
        <ConversionBadge rate={createdToApproved} label="approved" />
        <FunnelStage
          label="Approved"
          count={m.approved}
          value={m.approvedVal}
          color="border-indigo-200 bg-indigo-50"
        />
        <ConversionBadge rate={approvedToInvoiced} label="invoiced" />
        <FunnelStage
          label="Invoiced"
          count={m.invoiced}
          value={m.invoicedVal}
          color="border-purple-200 bg-purple-50"
        />
        <ConversionBadge rate={invoicedToPaid} label="collected" />
        <FunnelStage
          label="Paid"
          count={m.paid}
          value={m.paidVal}
          color="border-emerald-200 bg-emerald-50"
        />
        {m.hoRejected > 0 && (
          <>
            <div className="w-px h-10 bg-slate-200 mx-1 hidden sm:block" />
            <FunnelStage
              label="HO Rejected"
              count={m.hoRejected}
              value={m.hoRejectedVal}
              color="border-rose-200 bg-rose-50"
              sublabel="of approved"
            />
          </>
        )}
      </div>

      {/* Conversion health summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500 mb-0.5">Created → Approved</p>
          <p className={cn("text-xl font-bold", createdToApproved >= 0.6 ? "text-emerald-700" : "text-amber-600")}>
            {Math.round(createdToApproved * 100)}%
          </p>
          <p className="text-xs text-slate-400">{m.approved} of {m.created} quotes</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500 mb-0.5">Approved → Invoiced</p>
          <p className={cn("text-xl font-bold", approvedToInvoiced >= 0.6 ? "text-emerald-700" : "text-amber-600")}>
            {Math.round(approvedToInvoiced * 100)}%
          </p>
          <p className="text-xs text-slate-400">{m.invoiced} of {m.approved} approved</p>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500 mb-0.5">Invoiced → Paid</p>
          <p className={cn("text-xl font-bold", invoicedToPaid >= 0.6 ? "text-emerald-700" : "text-amber-600")}>
            {Math.round(invoicedToPaid * 100)}%
          </p>
          <p className="text-xs text-slate-400">{m.paid} of {m.invoiced} invoiced</p>
        </div>
      </div>

      {/* Multi-quarter table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Quarter</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Created</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Created $</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Approved</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Approved $</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">HO Rejected</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Invoiced</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Invoiced $</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Paid</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Paid $</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">Inv→Paid</th>
            </tr>
          </thead>
          <tbody>
            {[...displayKeys].reverse().map(key => {
              const mx = computeMetrics(quarters[key] || []);
              const invToPaid = mx.invoiced > 0 ? Math.round((mx.paid / mx.invoiced) * 100) : null;
              const isCurrent = key === currentKey;
              return (
                <tr key={key} className={cn("border-b border-slate-50 hover:bg-slate-50", isCurrent && "bg-indigo-50/40")}>
                  <td className="py-2.5 px-3 font-semibold text-slate-800">
                    {key} {isCurrent && <span className="text-xs font-normal text-indigo-500 ml-1">(current)</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">{mx.created}</td>
                  <td className="py-2.5 px-3 text-right text-slate-500">{formatCurrency(mx.createdVal)}</td>
                  <td className="py-2.5 px-3 text-right text-indigo-700 font-medium">{mx.approved}</td>
                  <td className="py-2.5 px-3 text-right text-indigo-500">{formatCurrency(mx.approvedVal)}</td>
                  <td className="py-2.5 px-3 text-right text-rose-600">{mx.hoRejected > 0 ? mx.hoRejected : "—"}</td>
                  <td className="py-2.5 px-3 text-right text-purple-700 font-medium">{mx.invoiced}</td>
                  <td className="py-2.5 px-3 text-right text-purple-500">{formatCurrency(mx.invoicedVal)}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-700 font-medium">{mx.paid}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-600">{formatCurrency(mx.paidVal)}</td>
                  <td className="py-2.5 px-3 text-right">
                    {invToPaid !== null
                      ? <span className={cn("font-semibold", invToPaid >= 60 ? "text-emerald-700" : "text-amber-600")}>{invToPaid}%</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}