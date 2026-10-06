import {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {QUOTE_STATUSES} from "@/constants/quoteStatuses";
import {buildQuoteLifecycleReport, durationLabel, statusLabel} from "@/features/quoteDashboard/quoteLifecycle";
import {RANGE_PRESETS, resolveDateRange, todayStr} from "@/features/supervisorDashboard/dateRanges";
import {createPageUrl} from "@/utils";
import QuoteLifecycleCharts from "./QuoteLifecycleCharts";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";

const PAGE_SIZE = 50;
const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function quoteName(quote) {
  return quote.quote_number || quote.case_number || quote.site_id || quote.id;
}

function QuoteLink({quote}) {
  return <Link className="text-primary underline" to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(quote.id)}`)}>{quoteName(quote)}</Link>;
}

function Table({headings, children}) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr>{headings.map(heading => <th key={heading} className="p-2 text-left font-medium text-muted-foreground">{heading}</th>)}</tr></thead>
    <tbody className="[&_td]:p-2 [&_tr]:border-t">{children}</tbody>
  </table></div>;
}

function Section({title, description, children}) {
  return <Card><CardHeader><CardTitle className="text-base"><h3>{title}</h3></CardTitle>
    {description && <p className="text-sm text-muted-foreground">{description}</p>}
  </CardHeader><CardContent>{children}</CardContent></Card>;
}

function eventLabel(event) {
  if (event.kind === "created") return "Quote created";
  if (event.kind === "follow_up") return `Follow-up (${statusLabel(event.to)})`;
  if (event.kind === "note") return `Note / same status (${statusLabel(event.to)})`;
  if (event.kind === "recorded") return `First recorded status: ${statusLabel(event.to)}`;
  if (event.kind === "audit") return `Quote ${event.action || "updated"}${event.fields.length ? `: ${event.fields.join(", ")}` : ""}`;
  return `${statusLabel(event.from)} -> ${statusLabel(event.to)}`;
}

export default function QuoteLifecyclePanel({quotes, activities = []}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [preset, setPreset] = useState(RANGE_PRESETS.LAST_30_DAYS);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [includeOnHold, setIncludeOnHold] = useState(true);
  const [includeExcluded, setIncludeExcluded] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [activityPage, setActivityPage] = useState(0);
  const [quotePage, setQuotePage] = useState(0);
  const [view, setView] = useState("overview");
  const range = preset === RANGE_PRESETS.ALL_HISTORY ? {start: null, end: null}
    : resolveDateRange({preset, startDate: customStart, endDate: preset === RANGE_PRESETS.CUSTOM_RANGE ? customEnd : todayStr()});
  const invalidRange = preset === RANGE_PRESETS.CUSTOM_RANGE && (!customStart || !customEnd || customStart > customEnd);
  const report = useMemo(() => buildQuoteLifecycleReport(quotes, {
    range, status, search, includeOnHold, includeExcluded, now, activities
  }), [quotes, range.start, range.end, status, search, includeOnHold, includeExcluded, now, activities]);
  useEffect(() => {
    setActivityPage(0);
    setQuotePage(0);
  }, [range.start, range.end, status, search, includeOnHold, includeExcluded]);
  const selected = report.timelines.find(item => item.quote.id === selectedId);
  const aging = [...report.timelines].sort((a, b) => (b.currentHours ?? -1) - (a.currentHours ?? -1));
  const currentQuotePage = Math.min(quotePage, Math.max(0, Math.ceil(aging.length / PAGE_SIZE) - 1));
  const currentActivityPage = Math.min(activityPage, Math.max(0, Math.ceil(report.activity.length / PAGE_SIZE) - 1));
  const statuses = [...new Set([...QUOTE_STATUSES.filter(item => !item.localOnly).map(item => item.value),
    ...quotes.map(quote => quote.status).filter(Boolean)])];
  function pagination(page, count, setter) {
    const max = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
    return <div className="mt-3 flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setter(page - 1)}>Previous</Button>
      <span className="text-xs text-muted-foreground">Page {Math.min(page, max) + 1} of {max + 1} ({count} rows)</span>
      <Button variant="outline" size="sm" disabled={page >= max} onClick={() => setter(page + 1)}>Next</Button>
    </div>;
  }
  return <div className="space-y-6">
    <Card><CardContent className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">Activity period
          <select aria-label="Activity period" className={selectClass} value={preset} onChange={event => setPreset(event.target.value)}>
            <option value={RANGE_PRESETS.LAST_30_DAYS}>Last 30 Days</option>
            <option value={RANGE_PRESETS.LAST_7_DAYS}>Last 7 Days</option>
            <option value={RANGE_PRESETS.TODAY}>Today</option>
            <option value={RANGE_PRESETS.ALL_HISTORY}>All Available History</option>
            <option value={RANGE_PRESETS.CUSTOM_RANGE}>Custom Range</option>
          </select>
        </label>
        {preset === RANGE_PRESETS.CUSTOM_RANGE && <>
          <label className="text-sm">Start date<Input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} /></label>
          <label className="text-sm">End date<Input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label>
        </>}
        <label className="flex flex-col gap-1 text-sm">Current status
          <select aria-label="Current status" className={`${selectClass} max-w-72`} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Find quotes
          <Input placeholder="Quote, case, site, customer, or owner" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <label><input type="checkbox" checked={includeOnHold} onChange={event => setIncludeOnHold(event.target.checked)} /> Include on-hold quotes</label>
        <label><input type="checkbox" checked={includeExcluded} onChange={event => setIncludeExcluded(event.target.checked)} /> Include reporting-excluded quotes</label>
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Sources and reporting rules</summary>
        <p className="mt-2">Status History is authoritative for transitions and elapsed stage time. Current age runs from the latest recorded visit matching the current status through now. Quote explorer measures time to the previous status from entry into the status before it until entry into that previous status. Follow-ups and repeated same-status notes do not reset these clocks; older history gaps remain warnings without hiding usable dated entries. Turnaround summarizes the previous-to-current interval separately. Activity Log supplies creation and edit audit records; logging an edit never counts as another status transition. Creation uses the activity creation record when present, otherwise the quote creation date. Current versions only. Date filters select activity, not quote timings or the live pipeline. Missing and conflicting data is flagged rather than guessed.</p>
      </details>
    </CardContent></Card>
    {invalidRange ? <p role="alert" className="text-destructive">Choose both dates, with start date on or before end date.</p> : <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Current quotes in scope", report.timelines.length],
          ["New quotes in period", report.newQuotes],
          ["Status changes in period", report.transitions.length],
          ["Distinct quotes changed", report.changedQuotes]
        ].map(([label, value]) => <Card key={label}><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p>
        </CardContent></Card>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Quote Dashboard views">
          {[["overview", "Charts"], ["quotes", "Quote explorer"], ["audit", "Audit trail"], ["timing", "Timing details"], ["quality", "Data quality"]].map(([key, label]) =>
            <Button key={key} size="sm" variant={view === key ? "default" : "outline"} aria-pressed={view === key} onClick={() => setView(key)}>{label}</Button>)}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setView("quality")}>
          {report.issues.length} history gaps · {report.revisitedQuotes} repeat visits
        </Button>
      </div>
      {view === "overview" && <QuoteLifecycleCharts report={report} range={range} onInspect={setView} />}
      {view === "quality" && <Section title="History coverage and rework" description="Unknown history is never filled in from updated_date or guessed from the current status.">
        <p className="text-sm">{report.issues.length} quotes have history/date gaps or mismatches. {report.revisitedQuotes} quotes have returned to a previously recorded status (all available history).</p>
        {report.issues.length > 0 && <div className="mt-3">
          <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm">{report.issues.map(item => <li key={item.quote.id}>
            <QuoteLink quote={item.quote} />: {item.issues.join("; ")}
          </li>)}</ul>
        </div>}
      </Section>}
      {view === "timing" && <Section title="Status-to-status turnaround" description="Last two actual statuses per quote only. Previous-stage durations across all filtered quotes, regardless of activity date.">
        {report.durations.length ? <Table headings={["Previous status", "Current status", "Quotes", "Average", "Median", "Longest"]}>
          {report.durations.map(row => <tr key={JSON.stringify([row.from, row.to])}>
            <td>{statusLabel(row.from)}</td><td>{statusLabel(row.to)}</td><td>{row.count}</td>
            <td>{durationLabel(row.average)}</td><td>{durationLabel(row.median)}</td><td>{durationLabel(row.longest)}</td>
          </tr>)}
        </Table> : <p className="text-sm text-muted-foreground">No measurable last-status intervals for these quotes.</p>}
      </Section>}
      {view === "quotes" && <Section title="Quote explorer" description="Time to previous status: entry into the status before it to entry into the previous status. Current age: entry into the current status through now. Follow-ups and same-status notes are ignored. Oldest current stages first; activity dates do not limit these timings.">
        {!aging.length && <p className="text-sm text-muted-foreground">No quotes match these filters.</p>}
        <Table headings={["Quote / case / site", "Owner", "Previous status", "Time to previous status", "Current status", "Time in current status", "History"]}>
          {aging.slice(currentQuotePage * PAGE_SIZE, (currentQuotePage + 1) * PAGE_SIZE).map(item => <tr key={item.quote.id}>
            <td><QuoteLink quote={item.quote} /><div className="text-xs text-muted-foreground">Case {item.quote.case_number || "Unknown"} / Site {item.quote.site_id || "Unknown"}</div>
              {item.quote.exclude_from_reporting && <span className="text-xs">Reporting-excluded </span>}
            </td>
            <td>{item.quote.owner_email || item.quote.created_by || "Unknown"}</td>
            <td>{statusLabel(item.previousStatus)}{item.previousStatus && <div className="text-xs text-muted-foreground">From {statusLabel(item.previousFromStatus)}</div>}</td><td>{durationLabel(item.previousHours)}</td>
            <td>{statusLabel(item.quote.status)}</td><td>{durationLabel(item.currentHours)}</td>
            <td><Button size="sm" variant="outline" onClick={() => setSelectedId(item.quote.id)}>History</Button></td>
          </tr>)}
        </Table>
        {pagination(currentQuotePage, aging.length, setQuotePage)}
      </Section>}
      <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(""); }}>
        {selected && <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lifetime timeline: {quoteName(selected.quote)}</DialogTitle>
          <DialogDescription>Status History and Activity Log records, with their original dates and authors.</DialogDescription>
        </DialogHeader>
        {selected.issues.length > 0 && <p className="mb-3 text-sm text-amber-600">{selected.issues.join("; ")}</p>}
        <ol className="ml-2 border-l border-border">
          {selected.events.map((event, index) => <li key={index} className="relative ml-5 py-3">
            <span className={`absolute -left-[25px] top-5 h-2 w-2 rounded-full ${event.source === "Activity Log" ? "bg-teal-500" : "bg-indigo-500"}`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{eventLabel(event)}</span>
              <time className="text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</time>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{event.source} · {event.actor || "Unknown author"}
              {event.kind === "transition" && ` · Previous stage: ${durationLabel(event.hours)}`}
            </p>
            {event.reason && <p className="mt-2 whitespace-pre-wrap text-sm">{event.reason}</p>}
            {event.changes?.length > 0 && <details className="mt-2 text-xs">
              <summary className="cursor-pointer">Field changes ({event.changes.length})</summary>
              <ul className="mt-2 space-y-1 break-words">{event.changes.map((change, changeIndex) =>
                <li key={changeIndex}>{change.field}: {String(change.previous_value ?? "Unknown")} → {String(change.new_value ?? "Unknown")}</li>)}</ul>
            </details>}
          </li>)}
        </ol>
        {!selected.events.length && <p className="text-sm text-muted-foreground">No dated history is available.</p>}
        </DialogContent>}
      </Dialog>
      {view === "audit" && <Section title="Audit trail" description="Status History and Activity Log entries, newest first. Source labels distinguish recorded transitions from edit audit events.">
        <Table headings={["When (local time)", "Quote", "Event", "Source", "Changed by"]}>
          {report.activity.slice(currentActivityPage * PAGE_SIZE, (currentActivityPage + 1) * PAGE_SIZE).map((event, index) => <tr key={index}>
            <td>{new Date(event.at).toLocaleString()}</td><td><QuoteLink quote={event.quote} /></td>
            <td>{eventLabel(event)}</td><td>{event.source}</td><td>{event.actor || "Unknown"}</td>
          </tr>)}
        </Table>
        {pagination(currentActivityPage, report.activity.length, setActivityPage)}
      </Section>}
    </>}
  </div>;
}
