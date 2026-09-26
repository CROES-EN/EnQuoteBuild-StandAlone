import {Card} from "@/components/ui/card";
import {Clock, DollarSign, FileText, User} from "lucide-react";
import {differenceInHours, parseISO} from "date-fns";

export default function CoordinatorPerformance({ quotes }) {
  // Group by coordinator (created_by)
  const coordinatorStats = quotes.reduce((acc, quote) => {
    const coordinator = quote.created_by || 'Unknown';
    if (!acc[coordinator]) {
      acc[coordinator] = {
        name: coordinator,
        totalQuotes: 0,
        approvedQuotes: 0,
        rejectedQuotes: 0,
        totalValue: 0,
        avgApprovalTime: 0,
        approvalTimes: []
      };
    }
    
    acc[coordinator].totalQuotes += 1;
    acc[coordinator].totalValue += quote.total || 0;
    
    if (quote.status === 'approved' || quote.status === 'quote_sent_to_ho' || 
        quote.status === 'ho_approved_invoice_required' || quote.status === 'invoiced' || 
        quote.status === 'invoice_paid' || quote.status === 'scheduled') {
      acc[coordinator].approvedQuotes += 1;
    }
    
    if (quote.status === 'rejected' || quote.status === 'ho_rejected') {
      acc[coordinator].rejectedQuotes += 1;
    }
    
    if (quote.approved_date && quote.submitted_date) {
      const hours = differenceInHours(parseISO(quote.approved_date), parseISO(quote.submitted_date));
      acc[coordinator].approvalTimes.push(hours);
    }
    
    return acc;
  }, {});

  // Calculate average approval times
  Object.values(coordinatorStats).forEach(stats => {
    if (stats.approvalTimes.length > 0) {
      stats.avgApprovalTime = stats.approvalTimes.reduce((a, b) => a + b, 0) / stats.approvalTimes.length;
    }
  });

  const sortedCoordinators = Object.values(coordinatorStats)
    .sort((a, b) => b.totalQuotes - a.totalQuotes)
    .slice(0, 5);

  return (
    <Card className="p-6 border-border">
      <h3 className="text-lg font-semibold text-foreground mb-4">Top Coordinators</h3>
      <div className="space-y-4">
        {sortedCoordinators.map((coordinator, index) => {
          const approvalRate = coordinator.totalQuotes > 0
            ? ((coordinator.approvedQuotes / coordinator.totalQuotes) * 100).toFixed(0)
            : 0;

          return (
            <div key={index} className="p-4 bg-secondary rounded-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{coordinator.name}</p>
                    <p className="text-sm text-muted-foreground">{coordinator.totalQuotes} quotes</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Approval Rate</p>
                  <p className="text-lg font-bold text-green-600">{approvalRate}%</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2 bg-card rounded">
                  <FileText className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Approved</p>
                  <p className="text-sm font-semibold text-foreground">{coordinator.approvedQuotes}</p>
                </div>
                <div className="text-center p-2 bg-card rounded">
                  <Clock className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Avg Time</p>
                  <p className="text-sm font-semibold text-foreground">
                    {coordinator.avgApprovalTime > 0 ? `${coordinator.avgApprovalTime.toFixed(1)}h` : 'N/A'}
                  </p>
                </div>
                <div className="text-center p-2 bg-card rounded">
                  <DollarSign className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Total Value</p>
                  <p className="text-sm font-semibold text-foreground">
                    ${(coordinator.totalValue / 1000).toFixed(1)}k
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}