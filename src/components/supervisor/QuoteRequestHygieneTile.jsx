import {Link} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {useQuoteRequestHygieneReport} from "@/features/autoDrafter/useQuoteRequestHygieneReport";
import {buildQuoteRequestHygieneReport} from "@/features/autoDrafter/quoteRequestHygiene";

export default function QuoteRequestHygieneTile() {
  const query = useQuoteRequestHygieneReport();
  const report = query.data ? buildQuoteRequestHygieneReport(query.data) : null;
  return <div className="rounded-xl border border-border bg-secondary p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quote Request Data Hygiene</p>
    {query.isError ? <div role="alert" className="mt-2 text-sm text-destructive">
      Unable to load quote request report: {query.error.message}
      <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry hygiene report</Button>
    </div> : query.isLoading ? <p role="status">Loading request report...</p> : !report ? <p className="mt-2 text-sm">Import a quote request report in Data Hygiene or Auto-Drafter to review intake hygiene.</p> : <>
      <p className="mt-2 text-3xl font-bold">{report.flagged.length}</p>
      <p className="text-xs text-muted-foreground">{report.records.length} request cases; {report.authors.filter(author => author.flagged).length} comment authors with flagged cases</p>
      <p className="mt-2 text-xs text-muted-foreground">Latest imported report, not the dashboard date range. Flags require review; photos and agent usage are unverified.</p>
    </>}
    <Button asChild size="sm" variant="outline" className="mt-3">
      <Link to="/SupervisorDashboard?tab=data-hygiene">Review request hygiene</Link>
    </Button>
  </div>;
}
