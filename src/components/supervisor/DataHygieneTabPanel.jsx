import React, {useMemo, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import QuoteRequestHygieneReview from "@/components/autoDrafter/QuoteRequestHygieneReview";
import HygieneHeatmap from "@/components/supervisor/HygieneHeatmap";
import HygieneTrendChart from "@/components/supervisor/HygieneTrendChart";
import {buildQuoteRequestHygieneReport} from "@/features/autoDrafter/quoteRequestHygiene";
import {useQuoteRequestHygieneReport, HYGIENE_HISTORY_QUERY_KEY, HYGIENE_QUERY_KEY} from "@/features/autoDrafter/useQuoteRequestHygieneReport";

export default function DataHygieneTabPanel() {
  const query = useQuoteRequestHygieneReport();
  const client = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [authorFilter, setAuthorFilter] = useState("all");
  const report = useMemo(() => buildQuoteRequestHygieneReport(query.data), [query.data]);
  const currentAuthor = report.authors.some(author => author.author === authorFilter) ? authorFilter : "all";
  const topAuthors = report.authors.filter(author => author.flagged).slice(0, 10);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Data Hygiene</h2>
        <p className="mt-1 text-sm text-muted-foreground">Quote Request SOP intake review by recorded comment author. Findings require verification before coaching or escalation.</p></div>
      <div className="flex gap-2">
        <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh hygiene</Button>
        <Button onClick={() => setImportOpen(true)}>Import request report</Button>
      </div>
    </div>
    {query.isError ? <Card role="alert"><CardContent className="p-4 text-destructive">Unable to load request report: {query.error.message}. Use Refresh hygiene to retry.</CardContent></Card>
      : query.isLoading ? <p role="status">Loading request hygiene...</p>
      : !query.data ? <Card><CardContent className="p-6">Import the Salesforce case report with Case Comments, Case Comment Created By, Case Comment Created Date, and O&amp;M Status. The same report is also used by Auto-Drafter.</CardContent></Card>
      : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ["Request cases reviewed", report.records.length],
            ["Cases needing review", report.flagged.length],
            ["Authors with flagged cases", report.authors.filter(author => author.flagged).length],
            ["Flagged-case rate", `${report.records.length ? Math.round(report.flagged.length / report.records.length * 100) : 0}%`]
          ].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></CardContent></Card>)}
        </div>
        <p className="text-xs text-muted-foreground">Current imported snapshot, not historical compliance or the Executive Overview date range. Counts are unique retained request cases, not CSV text lines. Later quote-workflow statuses are observations, not automatic violations.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardHeader><CardTitle className="text-base">Comment authors with flagged cases</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">Top 10 authors whose request summaries need correction. Numbers show flagged cases.</p>
              {topAuthors.length ? <ResponsiveContainer width="100%" height={Math.max(240, topAuthors.length * 36)}>
                <BarChart data={topAuthors} layout="vertical" margin={{left: 0, right: 40}}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="author" width={150} tick={{fontSize: 11}} />
                  <Tooltip /><Bar dataKey="flagged" name="Flagged cases" fill="hsl(var(--primary))">
                    <LabelList dataKey="flagged" position="right" fill="hsl(var(--foreground))" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer> : <p className="text-sm">No authors with detectable intake issues.</p>}
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Intake issue breakdown</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">What is missing or incorrect in the request. Numbers show affected cases; issues can overlap.</p>
              {report.issues.length ? <ResponsiveContainer width="100%" height={Math.max(240, report.issues.length * 36)}>
                <BarChart data={report.issues} layout="vertical" margin={{left: 0, right: 40}}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="issue" width={185} tick={{fontSize: 11}} />
                  <Tooltip /><Bar dataKey="cases" name="Cases needing review" fill="hsl(var(--primary))">
                    <LabelList dataKey="cases" position="right" fill="hsl(var(--foreground))" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer> : <p className="text-sm">No detectable intake issues.</p>}
            </CardContent>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <Card><CardHeader><CardTitle className="text-base">Flags by person</CardTitle></CardHeader>
            <CardContent><HygieneHeatmap report={report} selectedAuthor={currentAuthor} onSelectAuthor={setAuthorFilter} /></CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Hygiene trend</CardTitle></CardHeader>
            <CardContent><HygieneTrendChart /></CardContent>
          </Card>
        </div>
        <Card><CardHeader><CardTitle className="text-base">Requester / comment-author review</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label htmlFor="hygiene-author" className="text-sm font-medium">Comment author</label>
              <Select value={currentAuthor} onValueChange={setAuthorFilter}>
                <SelectTrigger id="hygiene-author" aria-label="Filter hygiene by author" className="sm:w-96"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All comment authors</SelectItem>
                  {report.authors.map(author => <SelectItem key={author.author} value={author.author}>
                    {author.author} ({author.flagged}/{author.requests} flagged, {Math.round(author.flagged / author.requests * 100)}%)
                  </SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <QuoteRequestHygieneReview table={query.data} authorFilter={currentAuthor === "all" ? "" : currentAuthor} />
          </CardContent>
        </Card>
      </>}
    <ImportAsTableDialog open={importOpen} onOpenChange={setImportOpen} reportType="quoteRequestCases" reportLabel="Quote Request Cases"
      onImported={() => {
        client.invalidateQueries({queryKey: HYGIENE_QUERY_KEY});
        client.invalidateQueries({queryKey: HYGIENE_HISTORY_QUERY_KEY});
        client.invalidateQueries({queryKey: ["report-tables-for-ops-overview"]});
      }} />
  </div>;
}
