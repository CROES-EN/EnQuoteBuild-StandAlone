import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {ChevronLeft, ChevronRight, ClipboardCopy, Download, FileDown, RefreshCw, Sparkles} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Textarea} from "@/components/ui/textarea";
import {Badge} from "@/components/ui/badge";
import {getAllQuoteActivities, getQuotes} from "@/api/dataClient";
import {buildQuoteLifecycleReport} from "@/features/quoteDashboard/quoteLifecycle";
import {listGeneratedDrafts} from "@/features/autoDrafter/autoDrafterDraftsStore";
import {withAutoDrafterActivity} from "@/features/autoDrafter/autoDrafterActivity";
import {formatDateLabel} from "@/features/supervisorDashboard/format";
import {
    computeBacklogReconciliationVariance,
    computeExpectedEndingBacklog,
    draftExecutiveSummaryBullets,
    resolveReportingTimeZone
} from "@/features/supervisorDashboard/omSnapshotCalculations";
import {computeQuoteOpsMetrics, DEFAULT_COMPLETED_STATUSES} from "@/features/supervisorDashboard/quoteOpsMetrics";
import {
    buildSnapshotMarkdown,
    copySnapshotMarkdown,
    downloadSnapshotMarkdown,
    downloadSnapshotPDF
} from "@/features/supervisorDashboard/omSnapshotExport";
import {buildDailySourceSections} from "@/features/supervisorDashboard/dailySnapshotSources";
import {listReportTables} from "@/features/supervisorDashboard/importedTableStore";
import {useQuoteBacklog} from "@/features/supervisorDashboard/useQuoteBacklog";
import {draftInsightBullets} from "@/features/supervisorDashboard/supervisorInsights";
import {useAutoDrafterAccuracy, useBacklogFlow, usePanelRmaCycle} from "@/features/supervisorDashboard/useSupervisorInsights";
import {useQuoteRequestHygieneHistory, useQuoteRequestHygieneReport} from "@/features/autoDrafter/useQuoteRequestHygieneReport";
import {readCaseWorkTeam} from "@/components/supervisor/CaseWorkTiles";

/**
 * O&M Daily Operations Snapshot for `selectedDate`. The report body is built from the same
 * imported reports (EODB, Staffing, Email, SFDC-Quotes, Quote Request Cases, Case History) and
 * live EnQuote data as the Executive Overview, so Copy/Download Markdown and the PDF match what
 * the team already reviews. Missing reports are listed rather than filled with invented numbers.
 */
function shiftIsoDate(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function localIsoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function DailySnapshotReport({
  records = [],
  selectedDate,
  onSelectedDateChange,
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
  summaryText: controlledSummaryText,
  onSummaryTextChange
}) {
  const sortedRecords = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);
  const currentIndex = sortedRecords.findIndex(r => r.date === selectedDate);
  const current = currentIndex >= 0 ? sortedRecords[currentIndex] : { date: selectedDate };
  const previous = currentIndex > 0 ? sortedRecords[currentIndex - 1] : null;

  const quotesQuery = useQuery({queryKey: ["quotes-all-for-ops-metrics"], queryFn: getQuotes});
  const allQuotes = quotesQuery.data || [];
  const activitiesQuery = useQuery({queryKey: ["quoteActivity", "lifecycle"], queryFn: getAllQuoteActivities});
  const reportTablesQuery = useQuery({queryKey: ["report-tables-for-ops-overview"], queryFn: listReportTables});
  const autoDrafterQuery = useQuery({queryKey: ["autoDrafterGeneratedDrafts", "activity"], queryFn: listGeneratedDrafts});
  const backlogQuery = useQuoteBacklog(selectedDate);
  const hygieneHistoryQuery = useQuoteRequestHygieneHistory();
  // Mounting the report records today's hygiene summary into the history read below.
  useQuoteRequestHygieneReport();

  const quoteOps = useMemo(
    () => computeQuoteOpsMetrics(allQuotes, selectedDate, { completedStatuses }),
    [allQuotes, selectedDate, completedStatuses]
  );

  const timeZoneInfo = useMemo(() => resolveReportingTimeZone(), []);

  const hygieneSnapshot = useMemo(
    () => (hygieneHistoryQuery.data || []).find(snapshot => snapshot?.date === selectedDate && !snapshot.is_deleted) || null,
    [hygieneHistoryQuery.data, selectedDate]
  );

  const sources = useMemo(() => {
    if (!selectedDate) return {sections: [], missingReports: []};
    const lifecycle = quotesQuery.data && activitiesQuery.data
      ? withAutoDrafterActivity(buildQuoteLifecycleReport(quotesQuery.data, {range: {start: selectedDate, end: selectedDate}, activities: activitiesQuery.data}),
        autoDrafterQuery.data || [], {quotes: quotesQuery.data, range: {start: selectedDate, end: selectedDate}})
      : null;
    const backlog = backlogQuery.isError ? {error: backlogQuery.error?.message || "Could not load the quote backlog."}
      : backlogQuery.data || null;
    return buildDailySourceSections({
      date: selectedDate,
      reportTables: reportTablesQuery.data || {},
      quotes: quotesQuery.data || null,
      lifecycle,
      backlog,
      hygiene: hygieneSnapshot,
      caseWorkTeam: readCaseWorkTeam()
    });
  }, [selectedDate, quotesQuery.data, activitiesQuery.data, autoDrafterQuery.data, reportTablesQuery.data, backlogQuery.data,
    backlogQuery.isError, backlogQuery.error, hygieneSnapshot]);

  const reportData = useMemo(() => {
    const notes = [];
    if (reportTablesQuery.isError) notes.push(`Imported reports could not be loaded: ${reportTablesQuery.error?.message || "unknown error"}`);
    if (quotesQuery.isError) notes.push(`EnQuote quotes could not be loaded: ${quotesQuery.error?.message || "unknown error"}`);
    if (timeZoneInfo.isFallback) notes.push(`Could not resolve the system timezone - defaulted to ${timeZoneInfo.timeZone} (Mountain Time).`);
    return {
      reportingDate: formatDateLabel(selectedDate),
      reportingDateIso: selectedDate || null,
      reportingWindowLabel: selectedDate
        ? `${formatDateLabel(selectedDate)}, 12:00 AM-11:59 PM (${timeZoneInfo.timeZone}${timeZoneInfo.isFallback ? " - fallback" : ""})`
        : null,
      preparedAt: new Date().toLocaleString("en-US", { timeZone: timeZoneInfo.timeZone, dateStyle: "medium", timeStyle: "short" }),
      sections: sources.sections,
      missingReports: sources.missingReports,
      notes
    };
  }, [selectedDate, sources, timeZoneInfo, reportTablesQuery.isError, reportTablesQuery.error, quotesQuery.isError, quotesQuery.error]);

  const caseBacklogVariance = useMemo(() => computeBacklogReconciliationVariance(
    current?.case_backlog_end,
    computeExpectedEndingBacklog(current?.case_backlog_start, current?.new_cases_received, current?.cases_completed)
  ), [current]);

  const backlogFlowQuery = useBacklogFlow(selectedDate, 1);
  const drafterQuery = useAutoDrafterAccuracy();
  const rmaCycle = usePanelRmaCycle();
  const insightBullets = useMemo(() => draftInsightBullets({
    backlogFlow: backlogFlowQuery.data?.at(-1)?.date === selectedDate ? backlogFlowQuery.data.at(-1) : null,
    hygiene: hygieneSnapshot,
    drafter: drafterQuery.data || null,
    rma: rmaCycle.metrics
  }), [backlogFlowQuery.data, hygieneSnapshot, drafterQuery.data, rmaCycle.metrics, selectedDate]);

  const draftBullets = useMemo(
    () => draftExecutiveSummaryBullets({ current, previous, quoteOps, caseBacklogVariance, insightBullets }),
    [current, previous, quoteOps, caseBacklogVariance, insightBullets]
  );

  // Executive Summary text is lifted to the parent page (keyed by date) whenever
  // `onSummaryTextChange` is supplied, so it survives Radix Tabs unmounting this component when
  // the user switches tabs. Falls back to local-only state without a controlling parent.
  const isControlled = typeof onSummaryTextChange === "function";
  const [localSummaryText, setLocalSummaryText] = useState(() => draftBullets.join("\n"));

  useEffect(() => {
    if (isControlled) return;
    setLocalSummaryText(draftBullets.join("\n"));
    // Only reset when the date changes - re-drafting must be explicit (the "Regenerate" button)
    // so in-progress edits to the summary aren't silently clobbered by unrelated data edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isControlled]);

  const summaryText = isControlled
    ? (controlledSummaryText ?? draftBullets.join("\n"))
    : localSummaryText;

  function setSummaryText(text) {
    if (isControlled) onSummaryTextChange(text);
    else setLocalSummaryText(text);
  }

  const finalReportData = useMemo(() => ({
    ...reportData,
    executiveSummaryBullets: summaryText.split("\n").map(line => line.trim()).filter(Boolean)
  }), [reportData, summaryText]);

  function handleRegenerateDraft() {
    setSummaryText(draftBullets.join("\n"));
    toast.success("Executive summary redrafted from current data.");
  }

  async function handleCopyMarkdown() {
    try {
      await copySnapshotMarkdown(finalReportData);
      toast.success("Report copied to clipboard as Markdown.");
    } catch (error) {
      toast.error(error?.message || "Could not copy the report.");
    }
  }

  function handleDownloadMarkdown() {
    downloadSnapshotMarkdown(finalReportData);
  }

  function handleDownloadPDF() {
    try {
      downloadSnapshotPDF(finalReportData);
    } catch (error) {
      toast.error(error?.message || "Could not generate the PDF.");
    }
  }

  const markdownPreview = useMemo(() => buildSnapshotMarkdown(finalReportData), [finalReportData]);
  const loading = reportTablesQuery.isLoading || quotesQuery.isLoading;

  return (
    <div className="space-y-4" data-daily-snapshot>
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">O&amp;M Daily Operations Snapshot</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {finalReportData.reportingWindowLabel || "Select a date to build a report."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onSelectedDateChange && (
                <div className="flex items-center gap-1" data-snapshot-date-picker>
                  <Button variant="outline" size="icon" className="h-8 w-8" title="Previous day" aria-label="Previous day"
                    disabled={!selectedDate} onClick={() => onSelectedDateChange(shiftIsoDate(selectedDate, -1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <input type="date" aria-label="Report date" data-snapshot-date
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    value={selectedDate || ""} max={localIsoToday()}
                    onChange={event => event.target.value && onSelectedDateChange(event.target.value)} />
                  <Button variant="outline" size="icon" className="h-8 w-8" title="Next day" aria-label="Next day"
                    disabled={!selectedDate || selectedDate >= localIsoToday()}
                    onClick={() => onSelectedDateChange(shiftIsoDate(selectedDate, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {sortedRecords.length > 0 && selectedDate !== sortedRecords.at(-1).date && (
                    <Button variant="ghost" size="sm" className="h-8" title="Jump to the most recent recorded day"
                      onClick={() => onSelectedDateChange(sortedRecords.at(-1).date)}>
                      Latest
                    </Button>
                  )}
                </div>
              )}
              <Badge variant="outline" className="border-border text-muted-foreground">
                Prepared {finalReportData.preparedAt}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyMarkdown} disabled={loading} data-snapshot-copy-markdown>
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadMarkdown} disabled={loading}>
              <Download className="mr-2 h-4 w-4" />
              Download Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={loading}>
              <FileDown className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Executive Summary (editable)
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={handleRegenerateDraft}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Regenerate Draft
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
            rows={6}
            placeholder="One bullet per line…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Auto-drafted from today's deltas, escalations, and backlog swings - edit freely before exporting. Don't
            overstate trends from a single day.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {finalReportData.sections.map(section => (
            <div key={section.title} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-foreground">{section.title} <span className="font-normal text-muted-foreground">· {section.source}</span></span>
              <span className={String(section.freshness || "").startsWith("Stale") ? "text-amber-600" : "text-muted-foreground"}>
                {section.freshness || "Freshness unknown"}
              </span>
            </div>
          ))}
          {!finalReportData.sections.length && !loading && (
            <p className="text-muted-foreground">No report data is available for this date yet.</p>
          )}
          {finalReportData.missingReports.length > 0 && (
            <p className="text-muted-foreground" data-snapshot-missing-reports>
              <span className="font-medium text-foreground">Not imported:</span> {finalReportData.missingReports.join("; ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Full Report Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-4 text-xs text-foreground" data-snapshot-preview>
            {markdownPreview}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
