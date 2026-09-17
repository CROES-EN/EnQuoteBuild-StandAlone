import { useEffect, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveDailyMetric } from "@/features/supervisorDashboard/opsMetricsStore";
import { formatNumber } from "@/features/supervisorDashboard/format";

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function blankForm() {
  return {
    case_backlog_start: "",
    new_cases_received: "",
    cases_completed: "",
    case_backlog_end: ""
  };
}

function recordToForm(record) {
  return {
    case_backlog_start: record?.case_backlog_start ?? "",
    new_cases_received: record?.new_cases_received ?? "",
    cases_completed: record?.cases_completed ?? "",
    case_backlog_end: record?.case_backlog_end ?? ""
  };
}

function hasNumber(value) {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

function computeNetBacklogChange(start, end) {
  if (!hasNumber(start) || !hasNumber(end)) return null;
  return end - start;
}

function computeExpectedEndingBacklog(start, received, completed) {
  if (!hasNumber(start) || !hasNumber(received) || !hasNumber(completed)) return null;
  return start + received - completed;
}

function computeReconciliationVariance(actualEnd, expectedEnd) {
  if (!hasNumber(actualEnd) || !hasNumber(expectedEnd)) return null;
  return actualEnd - expectedEnd;
}

function ComputedMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value === null ? "N/A" : formatNumber(value)}</p>
    </div>
  );
}

export default function CaseBacklogPanel({ records, selectedDate, onChanged }) {
  const safeRecords = Array.isArray(records) ? records : [];
  const current = safeRecords.find((record) => record.date === selectedDate);
  const [form, setForm] = useState(() => recordToForm(current));
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const lastSyncedDateRef = useRef(selectedDate);

  useEffect(() => {
    if (selectedDate !== lastSyncedDateRef.current) {
      lastSyncedDateRef.current = selectedDate;
      setForm(recordToForm(current));
      setIsDirty(false);
      return;
    }
    if (!isDirty) setForm(recordToForm(current));
  }, [current, selectedDate, isDirty]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
        case_backlog_start: toNumberOrNull(form.case_backlog_start),
        new_cases_received: toNumberOrNull(form.new_cases_received),
        cases_completed: toNumberOrNull(form.cases_completed),
        case_backlog_end: toNumberOrNull(form.case_backlog_end),
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved case backlog metrics for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error.message || "Could not save case backlog metrics.");
    } finally {
      setSaving(false);
    }
  }

  const backlogStart = toNumberOrNull(form.case_backlog_start);
  const newCasesReceived = toNumberOrNull(form.new_cases_received);
  const casesCompleted = toNumberOrNull(form.cases_completed);
  const backlogEnd = toNumberOrNull(form.case_backlog_end);
  const expectedEndingBacklog = computeExpectedEndingBacklog(backlogStart, newCasesReceived, casesCompleted);

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          O&amp;M Case Backlog
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">Backlog at Start</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.case_backlog_start}
              onChange={(event) => updateField("case_backlog_start", event.target.value)}
              placeholder="e.g. 42"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">New Cases Received</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.new_cases_received}
              onChange={(event) => updateField("new_cases_received", event.target.value)}
              placeholder="e.g. 18"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">Cases Completed</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.cases_completed}
              onChange={(event) => updateField("cases_completed", event.target.value)}
              placeholder="e.g. 15"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Backlog at End</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.case_backlog_end}
              onChange={(event) => updateField("case_backlog_end", event.target.value)}
              placeholder="e.g. 45"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ComputedMetric label="Net Backlog Change" value={computeNetBacklogChange(backlogStart, backlogEnd)} />
          <ComputedMetric label="Expected Ending Backlog" value={expectedEndingBacklog} />
          <ComputedMetric label="Reconciliation Variance" value={computeReconciliationVariance(backlogEnd, expectedEndingBacklog)} />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !selectedDate}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
