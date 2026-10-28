import {Link} from "react-router-dom";
import {Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {usePanelRmaCycle} from "@/features/supervisorDashboard/useSupervisorInsights";

const days = value => value === null || value === undefined ? "-" : `${value}d`;

export default function PanelRmaCyclePanel() {
  const query = usePanelRmaCycle();
  const metrics = query.metrics;
  return <Card className="border-border" data-panel-rma-cycle>
    <CardContent className="p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          All Panel RMAs in the tracker (not the dashboard date range). Durations use the recorded status history; RMAs saved before
          a status was recorded only count from their creation date. Decision = RMA Submitted to Approved, Rejected, or Deadend.
        </p>
        <Button asChild size="sm" variant="outline"><Link to="/PVPanelRMAs">Open PV Panel RMA Tracker</Link></Button>
      </div>
      {query.isError ? <div role="alert" className="text-sm text-destructive">
        Unable to load Panel RMAs: {query.error.message} <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
        : query.isLoading ? <p role="status" className="text-sm">Loading Panel RMAs...</p>
        : !metrics?.manufacturers.length ? <p className="text-sm text-muted-foreground">No Panel RMAs have been recorded yet.</p>
        : <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Cycle time by manufacturer</p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Manufacturer</th><th className="py-1 font-medium text-right">Open</th>
                  <th className="py-1 font-medium text-right">Closed</th><th className="py-1 font-medium text-right">Avg open age</th>
                  <th className="py-1 font-medium text-right">To submit</th><th className="py-1 font-medium text-right">Decision</th>
                  <th className="py-1 font-medium text-right">To close</th>
                </tr></thead>
                <tbody>{metrics.manufacturers.map(row => <tr key={row.manufacturer} className="border-t border-border">
                  <td className="py-1 pr-2">{row.manufacturer}</td><td className="py-1 text-right">{row.open}</td>
                  <td className="py-1 text-right">{row.closed}</td><td className="py-1 text-right">{days(row.avgOpenAge)}</td>
                  <td className="py-1 text-right">{days(row.avgDaysToSubmit)}</td><td className="py-1 text-right">{days(row.avgDecisionDays)}</td>
                  <td className="py-1 text-right">{days(row.avgDaysToClose)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Oldest open RMAs</p>
              {metrics.oldestOpen.length ? <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Case</th><th className="py-1 font-medium">Manufacturer</th>
                  <th className="py-1 font-medium">Status</th><th className="py-1 font-medium text-right">Open</th>
                  <th className="py-1 font-medium text-right">In status</th>
                </tr></thead>
                <tbody>{metrics.oldestOpen.map(rma => <tr key={rma.id} className="border-t border-border">
                  <td className="py-1 pr-2">{rma.caseId || rma.siteId || "-"}</td><td className="py-1 pr-2">{rma.manufacturer}</td>
                  <td className="py-1 pr-2">{rma.status}</td><td className="py-1 text-right">{rma.daysOpen}d</td>
                  <td className={`py-1 text-right ${rma.daysInStatus > 14 ? "font-semibold text-rose-600" : ""}`}>{rma.daysInStatus}d</td>
                </tr>)}</tbody>
              </table> : <p className="text-sm text-muted-foreground">No open Panel RMAs.</p>}
            </div>
          </div>
          {metrics.statusDwell.length > 0 && <div>
            <p className="mb-2 text-sm font-medium">Average days spent in each status</p>
            <ResponsiveContainer width="100%" height={Math.max(180, metrics.statusDwell.length * 32)}>
              <BarChart data={metrics.statusDwell} layout="vertical" margin={{left: 0, right: 50}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" unit="d" tick={{fontSize: 11}} />
                <YAxis type="category" dataKey="status" width={190} tick={{fontSize: 11}} />
                <Tooltip formatter={(value, name, item) => [`${value} days (${item.payload.visits} visits, ${item.payload.currentlyIn} in it now)`, "Average"]} />
                <Bar dataKey="avgDays" fill="hsl(var(--primary))" isAnimationActive={false}>
                  <LabelList dataKey="avgDays" position="right" fill="hsl(var(--foreground))" fontSize={11} formatter={value => `${value}d`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>}
        </>}
    </CardContent>
  </Card>;
}
