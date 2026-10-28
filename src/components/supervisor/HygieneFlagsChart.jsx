import {useMemo} from "react";
import {Link} from "react-router-dom";
import {Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {useQuoteRequestHygieneReport} from "@/features/autoDrafter/useQuoteRequestHygieneReport";
import {buildQuoteRequestHygieneReport} from "@/features/autoDrafter/quoteRequestHygiene";

const MAX_FLAGS = 10;

export default function HygieneFlagsChart() {
  const query = useQuoteRequestHygieneReport();
  const report = useMemo(() => query.data ? buildQuoteRequestHygieneReport(query.data) : null, [query.data]);
  const total = report?.records.length || 0;
  const flags = (report?.issues || []).slice(0, MAX_FLAGS)
    .map(flag => ({...flag, label: `${flag.cases} (${total ? Math.round(flag.cases / total * 100) : 0}%)`}));
  return <Card className="border-border" data-hygiene-flags-chart>
    <CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Top {MAX_FLAGS} intake flags in the latest imported quote request report (not the dashboard date range).
          Bars show flagged request cases and the share of all {total} request cases; a case can have several flags.
        </p>
        <Button asChild size="sm" variant="outline"><Link to="/SupervisorDashboard?tab=data-hygiene">Review in Data Hygiene</Link></Button>
      </div>
      {query.isError ? <div role="alert" className="text-sm text-destructive">
        Unable to load quote request report: {query.error.message}{" "}
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
        : query.isLoading ? <p role="status" className="text-sm">Loading request report...</p>
        : !report ? <p className="text-sm text-muted-foreground">Import a quote request report in Data Hygiene or Auto-Drafter to see the most common flags.</p>
        : !flags.length ? <p className="text-sm text-muted-foreground">No detectable intake flags in the imported report.</p>
        : <ResponsiveContainer width="100%" height={Math.max(220, flags.length * 38)}>
          <BarChart data={flags} layout="vertical" margin={{left: 0, right: 70}}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="issue" width={220} tick={{fontSize: 11}} />
            <Tooltip formatter={(value) => [`${value} of ${total} request cases`, "Flagged"]} />
            <Bar dataKey="cases" name="Flagged cases" fill="hsl(var(--primary))" isAnimationActive={false}>
              <LabelList dataKey="label" position="right" fill="hsl(var(--foreground))" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>}
    </CardContent>
  </Card>;
}
