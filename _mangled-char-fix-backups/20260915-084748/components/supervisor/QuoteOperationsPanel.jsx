import {useEffect, useMemo, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {FileText, Info} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {getQuotes} from "@/api/dataClient";
import {saveDailyMetric} from "@/features/supervisorDashboard/opsMetricsStore";
import {formatNumber} from "@/features/supervisorDashboard/format";
import {
    computeQuoteIntakeGap,
    computeQuoteOpsMetrics,
    DEFAULT_COMPLETED_STATUSES,
    isReportableQuote
} from "@/features/supervisorDashboard/quoteOpsMetrics";

// A curated subset of the full quote status vocabulary (see StatusBadge.jsx) offered as
// candidates for "Completed" - only the later-pipeline statuses that could plausibly represent
// O&M work finishing, not every status a quote can ever pass through.
const COMPLETED_STATUS_OPTIONS = [
  { value: "invoiced", label: "Quote Pending Payment (invoiced)" },
  { value: "invoice_paid", label: "Invoice Paid" },
  { value: "scheduled", label: "Scheduled" }
];

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function StatTile({ label, value, helperText }) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value === null || value === undefined ? "N/A" : formatNumber(value)}</p>
      {helperText && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  );
}

// `completedStatuses`/`onCompletedStatusesChange` are lifted to the parent Supervisor
// Dashboard page (rather than owned as local state here) so the Daily Snapshot Report tab can
// use the exact same "Completed" definition this tab shows - the spec requires the report to
// state the exact status set used, so the two need to agree, not drift independently.
export default function QuoteOperationsPanel({
  records = [],
  selectedDate,
  onChanged,
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
  onCompletedStatusesChange
}) {
  const current = records.find(record => record.date === selectedDate);
  const [sfQuotesReceived, setSfQuotesReceived] = useState(current?.sf_quotes_received ?? "");
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const lastSyncedDateRef = useRef(selectedDate);

  useEffect(() => {
    if (selectedDate !== lastSyncedDateRef.current) {
      lastSyncedDateRef.current = selectedDate;
      setSfQuotesReceived(current?.sf_quotes_received ?? "");
      setIsDirty(false);
      return;
    }
    if (!isDirty) setSfQuotesReceived(current?.sf_quotes_received ?? "");
  }, [current, selectedDate, isDirty]);

  // Live EnQuote quote data - same call SLAReporting.jsx already uses. Not cached under the
  // Supervisor Dashboard's own query key since this is shared, general-purpose quote data.
  const { data: allQuotes = [], isLoading, isError } = useQuery({
    queryKey: ["quotes-all-for-ops-metrics"],
    queryFn: getQuotes
  });

  const reportableCount = useMemo(() => allQuotes.filter(isReportableQuote).length, [allQuotes]);

  const quoteOps = useMemo(
    () => computeQuoteOpsMetrics(allQuotes, selectedDate, { completedStatuses }),
    [allQuotes, selectedDate, completedStatuses]
  );

  const sfReceivedNumber = toNumberOrNull(sfQuotesReceived);
  const intakeGap = computeQuoteIntakeGap(sfReceivedNumber, quoteOps.quotesDrafted);

  function toggleCompletedStatus(status, checked) {
    if (!onCompletedStatusesChange) return;
    const next = checked
      ? Array.from(new Set([...completedStatuses, status]))
      : completedStatuses.filter(s => s !== status);
    onCompletedStatusesChange(next);
  }

  function updateSfQuotesReceived(value) {
    setSfQuotesReceived(value);
    setIsDirty(true);
  }

  async function handleSave() {
    if (!selectedDate) {
      toast.error("Select a date before saving.");
      return;
    }
    setSaving(true);
    try {
      await saveDailyMetric({
        date: selectedDate,
        sf_quotes_received: toNumberOrNull(sfQuotesReceived),
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved Salesforce quote intake for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not save Salesforce quote intake.");
    }
    setSaving(false);
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-5 w-5 text-indigo-600" />
          Quote Operations
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Drafted, Completed, and Backlog are computed live from EnQuote's own quote data for{" "}
          {selectedDate || "the selected date"} - they're never manually entered and can't go stale.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isError && (
          <p className="text-sm text-rose-600">Could not load EnQuote quote data - these figures are unavailable right now.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Quotes Drafted" value={isLoading ? null : quoteOps.quotesDrafted} helperText="Created within the reporting window" />
          <StatTile label="Quotes Completed" value={isLoading ? null : quoteOps.quotesCompleted} helperText="Reached a Completed status in-window" />
          <StatTile label="Quote Backlog at Start" value={isLoading ? null : quoteOps.backlogStart} />
          <StatTile label="Quote Backlog at End" value={isLoading ? null : quoteOps.backlogEnd} />
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">"Completed" status definition</p>
          <p className="mb-3 text-xs text-muted-foreground">
            The business hasn't formally ratified a single "Completed" status - the exact set checked below is what's
            counted above and always shown on the Daily Snapshot Report.
          </p>
          <div className="flex flex-wrap gap-4">
            {COMPLETED_STATUS_OPTIONS.map(option => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={completedStatuses.includes(option.value)}
                  onCheckedChange={(checked) => toggleCompletedStatus(option.value, Boolean(checked))}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block">Salesforce Quotes Received</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={sfQuotesReceived}
              onChange={(e) => updateSfQuotesReceived(e.target.value)}
              placeholder="e.g. 28"
            />
            <p className="mt-1 text-xs text-muted-foreground">Manual entry - no live Salesforce integration exists yet.</p>
          </div>
          <StatTile
            label="Unreconciled Quote Requests (approximate)"
            value={intakeGap}
            helperText="Salesforce Received âˆ’ EnQuote Drafted. Not a true Case Number â†” Quote ID match."
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{formatNumber(reportableCount)} EnQuote quotes considered reportable (current version, not Boneyard, not excluded from reporting).</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !selectedDate}>{saving ? "Savingâ€¦" : "Save"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
