import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCopy, Download, FileDown, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getQuotes } from "@/api/dataClient";
import {
  formatNumber,
  formatSecondsAsClock,
  formatRate,
  formatDateLabel,
  formatOrFallback
} from "@/features/supervisorDashboard/format";
import {
  computeAbandonRate,
  computeHandleRate,
  computeStaffingAvailabilityRate,
  computeNetBacklogChange,
  computeExpectedEndingBacklog,
  computeBacklogReconciliationVariance,
  resolveReportingTimeZone,
  deriveUnavailableMetrics,
  deriveReconciliationExceptions,
  deriveManualInputsUsed,
  draftExecutiveSummaryBullets
} from "@/features/supervisorDashboard/omSnapshotCalculations";
import {
  computeQuoteOpsMetrics,
  computeQuoteIntakeGap,
  DEFAULT_COMPLETED_STATUSES
} from "@/features/supervisorDashboard/quoteOpsMetrics";
import {
  buildSnapshotMarkdown,
  downloadSnapshotMarkdown,
  copySnapshotMarkdown,
  downloadSnapshotPDF
} from "@/features/supervisorDashboard/omSnapshotExport";

// A source's data is flagged "stale" only when it was recorded more than 5 calendar days after
// the reporting date it's attached to - a conservative threshold that doesn't flag the feature's
// normal workflow (entering yesterday's numbers this morning), only clearly old/forgotten data.
const STALE_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;

function num(value) {
  return formatOrFallback(value, formatNumber, null);
}

function rate(value) {
  return value === null || value === undefined ? null : formatRate(value);
}

function clock(value) {
  return formatOrFallback(value, formatSecondsAsClock, null);
}

function formatTimestamp(iso, timeZone) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}

function latestSourceTimestamp(record, tags, timeZone) {
  const timestamps = tags.map(tag => record?.sources?.[tag]?.imported_at).filter(Boolean).sort();
  return timestamps.length ? formatTimestamp(timestamps[timestamps.length - 1], timeZone) : null;
}

function staleSourceLabels(record, sectionsWithTags) {
  const reportMs = record?.date ? new Date(`${record.date}T00:00:00`).getTime() : null;
  if (reportMs === null || Number.isNaN(reportMs)) return [];

  return sectionsWithTags
    .filter(({ tags }) => tags.some(tag => {
      const iso = record?.sources?.[tag]?.imported_at;
      if (!iso) return false;
      const importedMs = new Date(iso).getTime();
      return Number.isFinite(importedMs) && importedMs - reportMs > STALE_THRESHOLD_MS;
    }))
    .map(({ label }) => label);
}

/**
 * Composes every Supervisor Dashboard tab's data for `selectedDate` into the O&M Daily
 * Operations Snapshot's exact `REQUIRED OUTPUT` structure, with guarded calculations (never a
 * fabricated number), an auto-drafted/editable Executive Summary, and Markdown/PDF export.
 */
export default function DailySnapshotReport({
  records = [],
  selectedDate,
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
  summaryText: controlledSummaryText,
  onSummaryTextChange
}) {
  const sortedRecords = useMemo(() => [...records].sort((a, b) => a.date.localeCompare(b.date)), [records]);
  const currentIndex = sortedRecords.findIndex(r => r.date === selectedDate);
  const current = currentIndex >= 0 ? sortedRecords[currentIndex] : { date: selectedDate };
  const previous = currentIndex > 0 ? sortedRecords[currentIndex - 1] : null;

  const { data: allQuotes = [] } = useQuery({
    queryKey: ["quotes-all-for-ops-metrics"],
    queryFn: getQuotes
  });

  const quoteOps = useMemo(
    () => computeQuoteOpsMetrics(allQuotes, selectedDate, { completedStatuses }),
    [allQuotes, selectedDate, completedStatuses]
  );

  const timeZoneInfo = useMemo(() => resolveReportingTimeZone(), []);

  const reportData = useMemo(() => {
    const r = current || {};

    // --- Contact Center ---
    const abandonRate = computeAbandonRate(r.calls_abandoned, r.calls_offered);
    const handleRate = computeHandleRate(r.calls, r.calls_offered);
    const contactCenterEntries = [
      { label: "Calls Offered", value: r.calls_offered },
      { label: "Calls Handled", value: r.calls },
      { label: "Calls Abandoned", value: r.calls_abandoned },
      { label: "Average Handle Time", value: r.aht_seconds },
      { label: "Average Wait Time", value: r.avg_wait_seconds },
      { label: "Emails Received", value: r.emails_received },
      { label: "Emails Worked or Handled", value: r.emails_worked },
      { label: "Email Backlog at Start", value: r.email_backlog_start },
      { label: "Email Backlog at End", value: r.email_backlog_end }
    ];
    const contactCenter = {
      callsOffered: num(r.calls_offered),
      callsHandled: num(r.calls),
      callsAbandoned: num(r.calls_abandoned),
      abandonRate: rate(abandonRate),
      handleRate: rate(handleRate),
      aht: clock(r.aht_seconds),
      avgWait: clock(r.avg_wait_seconds),
      emailsReceived: num(r.emails_received),
      emailsWorked: num(r.emails_worked),
      emailBacklogStart: num(r.email_backlog_start),
      emailBacklogEnd: num(r.email_backlog_end),
      sourceRefreshTime: latestSourceTimestamp(r, ["cxone", "manual"], timeZoneInfo.timeZone)
    };

    // --- Staffing ---
    const staffingAvailabilityRate = computeStaffingAvailabilityRate(r.staffing_present, r.staffing_scheduled);
    const staffingEntries = [
      { label: "Team Headcount", value: r.team_headcount },
      { label: "Scheduled Staff", value: r.staffing_scheduled },
      { label: "Available Staff", value: r.staffing_present },
      { label: "Full-Day Absences", value: r.full_day_absences },
      { label: "Partial-Day Absences", value: r.partial_day_absences },
      { label: "Training/Meeting Capacity Loss", value: r.training_capacity_loss },
      { label: "Scheduled Productive Hours", value: r.scheduled_productive_hours },
      { label: "Actual Productive Hours", value: r.actual_productive_hours }
    ];
    const staffing = {
      teamHeadcount: num(r.team_headcount),
      scheduledStaff: num(r.staffing_scheduled),
      availableStaff: num(r.staffing_present),
      fullDayAbsences: num(r.full_day_absences),
      partialDayAbsences: num(r.partial_day_absences),
      trainingCapacityLoss: num(r.training_capacity_loss),
      scheduledProductiveHours: num(r.scheduled_productive_hours),
      actualProductiveHours: num(r.actual_productive_hours),
      staffingAvailabilityRate: rate(staffingAvailabilityRate),
      sourceRefreshTime: latestSourceTimestamp(r, ["manual"], timeZoneInfo.timeZone)
    };

    // --- Quote Operations (Drafted/Completed/Backlog are live-computed, never stored) ---
    const intakeGap = computeQuoteIntakeGap(r.sf_quotes_received, quoteOps.quotesDrafted);
    const quoteExpectedEnding = computeExpectedEndingBacklog(quoteOps.backlogStart, quoteOps.quotesDrafted, quoteOps.quotesCompleted);
    const quoteBacklogVariance = computeBacklogReconciliationVariance(quoteOps.backlogEnd, quoteExpectedEnding);
    const quoteOpsEntries = [
      { label: "Salesforce Quotes Received", value: r.sf_quotes_received },
      { label: "EnQuote Quotes Drafted", value: quoteOps.quotesDrafted },
      { label: "EnQuote Quotes Completed", value: quoteOps.quotesCompleted },
      { label: "Quote Backlog at Start", value: quoteOps.backlogStart },
      { label: "Quote Backlog at End", value: quoteOps.backlogEnd }
    ];
    const quoteOpsData = {
      sfQuotesReceived: num(r.sf_quotes_received),
      quotesDrafted: num(quoteOps.quotesDrafted),
      quotesCompleted: num(quoteOps.quotesCompleted),
      completedStatusesLabel: completedStatuses.join(", ") || "none selected",
      unreconciledQuoteRequests: num(intakeGap),
      backlogStart: num(quoteOps.backlogStart),
      backlogEnd: num(quoteOps.backlogEnd),
      sourceRefreshTime: `EnQuote data live as of now; Salesforce Received ${latestSourceTimestamp(r, ["manual"], timeZoneInfo.timeZone) || "N/A - Source unavailable"}`
    };

    // --- O&M Case Backlog ---
    const expectedEndingBacklog = computeExpectedEndingBacklog(r.case_backlog_start, r.new_cases_received, r.cases_completed);
    const netBacklogChange = computeNetBacklogChange(r.case_backlog_start, r.case_backlog_end);
    const reconciliationVariance = computeBacklogReconciliationVariance(r.case_backlog_end, expectedEndingBacklog);
    const caseBacklogEntries = [
      { label: "Backlog at Start", value: r.case_backlog_start },
      { label: "New Cases Received", value: r.new_cases_received },
      { label: "Cases Completed", value: r.cases_completed },
      { label: "Backlog at End", value: r.case_backlog_end }
    ];
    const caseBacklog = {
      backlogStart: num(r.case_backlog_start),
      newCasesReceived: num(r.new_cases_received),
      casesCompleted: num(r.cases_completed),
      backlogEnd: num(r.case_backlog_end),
      netBacklogChange: num(netBacklogChange),
      reconciliationVariance: num(reconciliationVariance),
      sourceRefreshTime: latestSourceTimestamp(r, ["manual"], timeZoneInfo.timeZone)
    };

    // --- Enphase Care ---
    const careEntries = [
      { label: "Care Appointment Cancellations", value: r.care_appt_cancellations },
      { label: "Care Plan Cancellation Requests", value: r.care_plan_cancellation_requests },
      { label: "Care Cancellations Completed", value: r.care_cancellations_completed },
      { label: "Care Refunds Initiated", value: r.care_refunds_initiated }
    ];
    const care = {
      apptCancellations: num(r.care_appt_cancellations),
      planCancellationRequests: num(r.care_plan_cancellation_requests),
      cancellationsCompleted: num(r.care_cancellations_completed),
      refundsInitiated: num(r.care_refunds_initiated)
    };

    // --- Blockers & Escalations ---
    const escalationEntries = [
      { label: "New S1 Escalations", value: r.new_s1 },
      { label: "New S2 Escalations", value: r.new_s2 },
      { label: "New S3 Escalations", value: r.new_s3 },
      { label: "Open Critical Escalations", value: r.open_critical_escalations },
      { label: "Overdue Follow-Ups", value: r.overdue_follow_ups }
    ];
    const blockerText = [r.major_blockers, r.travel_field_blockers].filter(Boolean).join(" | ") || null;
    const escalations = {
      newS1: num(r.new_s1),
      newS2: num(r.new_s2),
      newS3: num(r.new_s3),
      openCritical: num(r.open_critical_escalations),
      majorBlockers: blockerText,
      leadershipActionRequired: r.leadership_action_required || null,
      overdueFollowUps: num(r.overdue_follow_ups)
    };

    // --- Data Quality & Exceptions ---
    const unavailableMetrics = deriveUnavailableMetrics([
      ...contactCenterEntries, ...staffingEntries, ...quoteOpsEntries, ...caseBacklogEntries, ...careEntries, ...escalationEntries
    ]);
    const reconciliationExceptions = deriveReconciliationExceptions([
      { label: "O&M Case Backlog reconciliation variance", value: reconciliationVariance },
      { label: "Quote Backlog reconciliation variance", value: quoteBacklogVariance },
      { label: "Quote Intake Gap", value: intakeGap }
    ]);
    const staleSources = staleSourceLabels(r, [
      { label: "Contact Center", tags: ["cxone", "manual"] },
      { label: "Staffing", tags: ["manual"] },
      { label: "O&M Case Backlog", tags: ["manual"] },
      { label: "Enphase Care", tags: ["manual"] },
      { label: "Blockers & Escalations", tags: ["manual"] }
    ]);
    const filterTimezoneConcerns = timeZoneInfo.isFallback
      ? [`Could not resolve the system timezone - defaulted to ${timeZoneInfo.timeZone} (Mountain Time).`]
      : [];

    const dataQuality = {
      unavailableMetrics,
      staleSources,
      filterTimezoneConcerns,
      duplicateOrMalformed: [],
      reconciliationExceptions,
      manualInputsUsed: deriveManualInputsUsed(r)
    };

    return {
      reportingDate: formatDateLabel(selectedDate),
      reportingWindowLabel: selectedDate
        ? `${formatDateLabel(selectedDate)}, 12:00 AM-11:59 PM (${timeZoneInfo.timeZone}${timeZoneInfo.isFallback ? " - fallback" : ""})`
        : null,
      preparedAt: new Date().toLocaleString("en-US", { timeZone: timeZoneInfo.timeZone, dateStyle: "medium", timeStyle: "short" }),
      contactCenter,
      staffing,
      quoteOps: quoteOpsData,
      caseBacklog,
      care,
      escalations,
      dataQuality,
      // Internal-only: raw O&M Case Backlog variance, fed to the executive-summary drafter
      // below (not part of the exported report shape - omSnapshotExport.js's buildSections
      // only reads the named keys above and ignores this).
      _draftInputs: { reconciliationVariance }
    };
  }, [current, quoteOps, completedStatuses, selectedDate, timeZoneInfo]);

  const draftBullets = useMemo(
    () => draftExecutiveSummaryBullets({
      current,
      previous,
      quoteOps,
      caseBacklogVariance: reportData._draftInputs.reconciliationVariance
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, previous, quoteOps]
  );

  // Executive Summary text is lifted to the parent page (keyed by date) whenever
  // `onSummaryTextChange` is supplied, so it survives Radix Tabs unmounting this component when
  // the user switches to a different tab and back (this component otherwise has no Save button
  // for this field, unlike every other form in this feature). Falls back to local-only state
  // (matching the original behavior) if used without a controlling parent.
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

  const executiveSummaryBullets = summaryText.split("\n").map(line => line.trim()).filter(Boolean);
  const finalReportData = { ...reportData, executiveSummaryBullets };

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

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">O&amp;M Daily Operations Snapshot</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {finalReportData.reportingWindowLabel || "Select a date to build a report."}
              </p>
            </div>
            <Badge variant="outline" className="border-border text-muted-foreground">
              Prepared {finalReportData.preparedAt}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyMarkdown}>
              <ClipboardCopy className="mr-2 h-4 w-4" />
              Copy Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadMarkdown}>
              <Download className="mr-2 h-4 w-4" />
              Download Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
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
          <CardTitle className="text-base">Data Quality &amp; Exceptions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div><span className="font-medium text-foreground">Unavailable Metrics:</span> <span className="text-muted-foreground">{finalReportData.dataQuality.unavailableMetrics.join("; ") || "None"}</span></div>
          <div><span className="font-medium text-foreground">Stale Sources:</span> <span className="text-muted-foreground">{finalReportData.dataQuality.staleSources.join("; ") || "None"}</span></div>
          <div><span className="font-medium text-foreground">Filter/Timezone Concerns:</span> <span className="text-muted-foreground">{finalReportData.dataQuality.filterTimezoneConcerns.join("; ") || "None"}</span></div>
          <div><span className="font-medium text-foreground">Duplicate/Malformed Records:</span> <span className="text-muted-foreground">None recorded for this date</span></div>
          <div><span className="font-medium text-foreground">Reconciliation Exceptions:</span> <span className="text-muted-foreground">{finalReportData.dataQuality.reconciliationExceptions.join("; ") || "None"}</span></div>
          <div><span className="font-medium text-foreground">Manual Inputs Used:</span> <span className="text-muted-foreground">{finalReportData.dataQuality.manualInputsUsed.join("; ") || "None"}</span></div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Full Report Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-4 text-xs text-foreground">
            {markdownPreview}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
