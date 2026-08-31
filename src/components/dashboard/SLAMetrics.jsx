import { Card } from "@/components/ui/card";
import { Clock, CheckCircle, AlertCircle, TrendingUp } from "lucide-react";
import { differenceInHours, differenceInMinutes, parseISO } from "date-fns";

export default function SLAMetrics({ quotes }) {
  // Calculate average time to approval
  const approvedQuotes = quotes.filter(q => 
    q.approved_date && q.submitted_date
  );
  
  const avgApprovalTime = approvedQuotes.length > 0
    ? approvedQuotes.reduce((sum, q) => {
        return sum + differenceInHours(parseISO(q.approved_date), parseISO(q.submitted_date));
      }, 0) / approvedQuotes.length
    : 0;

  // Calculate average quote value
  const avgQuoteValue = quotes.length > 0
    ? quotes.reduce((sum, q) => sum + (q.total || 0), 0) / quotes.length
    : 0;

  // Calculate quotes pending approval
  const pendingQuotes = quotes.filter(q => q.status === 'submitted').length;

  // Calculate approval rate
  const submittedOrBeyond = quotes.filter(q => 
    q.status !== 'draft'
  ).length;
  const fullyApproved = quotes.filter(q => 
    q.status === 'approved' || q.status === 'quote_sent_to_ho' || 
    q.status === 'ho_approved_invoice_required' || q.status === 'invoiced' || 
    q.status === 'invoice_paid' || q.status === 'scheduled'
  ).length;
  const approvalRate = submittedOrBeyond > 0 
    ? ((fullyApproved / submittedOrBeyond) * 100).toFixed(1)
    : 0;

  // Calculate average time in each status
  const statusDurations = quotes.reduce((acc, quote) => {
    if (quote.status_history && quote.status_history.length > 1) {
      for (let i = 0; i < quote.status_history.length - 1; i++) {
        const current = quote.status_history[i];
        const next = quote.status_history[i + 1];
        const duration = differenceInHours(parseISO(next.changed_at), parseISO(current.changed_at));
        
        if (!acc[current.status]) {
          acc[current.status] = { total: 0, count: 0 };
        }
        acc[current.status].total += duration;
        acc[current.status].count += 1;
      }
    }
    return acc;
  }, {});

  const avgTimeInSubmitted = statusDurations['submitted'] 
    ? (statusDurations['submitted'].total / statusDurations['submitted'].count).toFixed(1)
    : 'N/A';

  return (
    <Card className="p-6 border-slate-200">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">SLA & Performance Metrics</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-blue-50 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-blue-600" />
            <p className="text-sm font-medium text-blue-900">Avg. Approval Time</p>
          </div>
          <p className="text-2xl font-bold text-blue-700">
            {avgApprovalTime > 0 ? `${avgApprovalTime.toFixed(1)}h` : 'N/A'}
          </p>
        </div>

        <div className="p-4 bg-green-50 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-sm font-medium text-green-900">Approval Rate</p>
          </div>
          <p className="text-2xl font-bold text-green-700">{approvalRate}%</p>
        </div>

        <div className="p-4 bg-amber-50 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <p className="text-sm font-medium text-amber-900">Pending Approval</p>
          </div>
          <p className="text-2xl font-bold text-amber-700">{pendingQuotes}</p>
        </div>

        <div className="p-4 bg-purple-50 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <p className="text-sm font-medium text-purple-900">Avg. Quote Value</p>
          </div>
          <p className="text-2xl font-bold text-purple-700">
            ${avgQuoteValue.toFixed(2)}
          </p>
        </div>

        <div className="p-4 bg-slate-50 rounded-lg md:col-span-2">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-slate-600" />
            <p className="text-sm font-medium text-slate-900">Avg. Time in Submitted Status</p>
          </div>
          <p className="text-2xl font-bold text-slate-700">
            {typeof avgTimeInSubmitted === 'number' ? `${avgTimeInSubmitted}h` : avgTimeInSubmitted}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Time between submission and approval/rejection
          </p>
        </div>
      </div>
    </Card>
  );
}