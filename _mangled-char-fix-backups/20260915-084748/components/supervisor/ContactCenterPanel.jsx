import {useEffect, useMemo, useRef, useState} from "react";
import {toast} from "sonner";
import {Mail, Phone} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {saveDailyMetric} from "@/features/supervisorDashboard/opsMetricsStore";
import {formatDateLabel, formatNumber, formatSecondsAsClock} from "@/features/supervisorDashboard/format";
import {parseDurationToSeconds} from "@/features/supervisorDashboard/reportParsing";

function blankForm() {
  return {
    calls_offered: "",
    calls: "",
    calls_abandoned: "",
    aht: "",
    avg_wait: "",
    emails_received: "",
    emails_worked: "",
    email_backlog_start: "",
    email_backlog_end: ""
  };
}

function recordToForm(record) {
  if (!record) return blankForm();
  return {
    calls_offered: record.calls_offered ?? "",
    calls: record.calls ?? "",
    calls_abandoned: record.calls_abandoned ?? "",
    aht: record.aht_seconds !== null && record.aht_seconds !== undefined ? formatSecondsAsClock(record.aht_seconds) : "",
    avg_wait: record.avg_wait_seconds !== null && record.avg_wait_seconds !== undefined ? formatSecondsAsClock(record.avg_wait_seconds) : "",
    emails_received: record.emails_received ?? "",
    emails_worked: record.emails_worked ?? "",
    email_backlog_start: record.email_backlog_start ?? "",
    email_backlog_end: record.email_backlog_end ?? ""
  };
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeAbandonRate(callsAbandoned, callsOffered) {
  if (!(callsOffered > 0) || callsAbandoned === null || callsAbandoned === undefined) return null;
  return callsAbandoned / callsOffered;
}

function computeHandleRate(callsHandled, callsOffered) {
  if (!(callsOffered > 0) || callsHandled === null || callsHandled === undefined) return null;
  return callsHandled / callsOffered;
}

function formatRate(rate) {
  return rate === null ? "N/A" : `${(rate * 100).toFixed(1)}%`;
}

function SummaryMetric({ icon: Icon, iconClass, label, value, subLabel }) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
          {subLabel ? <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function ContactCenterPanel({ records = [], selectedDate, onChanged }) {
  const current = records.find(record => record.date === selectedDate);
  const [form, setForm] = useState(() => recordToForm(current));
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const lastSyncedDateRef = useRef(selectedDate);

  useEffect(() => {
    if (selectedDate !== lastSyncedDateRef.current) {
      // Switched to a different day - always resync, abandoning any unsaved edits for the old day.
      lastSyncedDateRef.current = selectedDate;
      setForm(recordToForm(current));
      setIsDirty(false);
      return;
    }
    // Same day: `current` changed because something else (e.g. an import happening in a modal
    // while this tab stays mounted underneath) updated this date's record - don't clobber
    // in-progress edits the user hasn't saved yet.
    if (!isDirty) setForm(recordToForm(current));
  }, [current, selectedDate, isDirty]);

  const numericValues = useMemo(() => ({
    callsOffered: toNumberOrNull(form.calls_offered),
    callsHandled: toNumberOrNull(form.calls),
    callsAbandoned: toNumberOrNull(form.calls_abandoned)
  }), [form.calls, form.calls_abandoned, form.calls_offered]);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  async function handleSave() {
    if (!selectedDate) {
      toast.error("Select a date before saving Contact Center metrics.");
      return;
    }

    const ahtSeconds = form.aht.trim() ? parseDurationToSeconds(form.aht.trim()) : null;
    if (form.aht.trim() && ahtSeconds === null) {
      toast.error('Average Handle Time must look like "4:32" (mm:ss) or a number of seconds.');
      return;
    }

    const avgWaitSeconds = form.avg_wait.trim() ? parseDurationToSeconds(form.avg_wait.trim()) : null;
    if (form.avg_wait.trim() && avgWaitSeconds === null) {
      toast.error('Average Wait Time must look like "4:32" (mm:ss) or a number of seconds.');
      return;
    }

    setSaving(true);
    try {
      await saveDailyMetric({
        date: selectedDate,
        calls_offered: numericValues.callsOffered,
        calls: numericValues.callsHandled,
        calls_abandoned: numericValues.callsAbandoned,
        aht_seconds: ahtSeconds,
        avg_wait_seconds: avgWaitSeconds,
        emails_received: toNumberOrNull(form.emails_received),
        emails_worked: toNumberOrNull(form.emails_worked),
        email_backlog_start: toNumberOrNull(form.email_backlog_start),
        email_backlog_end: toNumberOrNull(form.email_backlog_end),
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved Contact Center metrics for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not save Contact Center metrics.");
    }
    setSaving(false);
  }

  const abandonRate = computeAbandonRate(numericValues.callsAbandoned, numericValues.callsOffered);
  const handleRate = computeHandleRate(numericValues.callsHandled, numericValues.callsOffered);

  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Contact Center</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Inline daily entry for queue volume, timing, and backlog snapshot data.
            </p>
          </div>
          <Badge variant="outline" className="border-border text-muted-foreground">
            {selectedDate ? formatDateLabel(selectedDate) : "No date selected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2">
          <SummaryMetric
            icon={Phone}
            iconClass="bg-rose-50 text-rose-600"
            label="Abandon Rate"
            value={formatRate(abandonRate)}
            subLabel={numericValues.callsOffered > 0 ? `${formatNumber(numericValues.callsAbandoned)} abandoned of ${formatNumber(numericValues.callsOffered)} offered` : "Requires Calls Offered"}
          />
          <SummaryMetric
            icon={Phone}
            iconClass="bg-emerald-50 text-emerald-600"
            label="Handle Rate"
            value={formatRate(handleRate)}
            subLabel={numericValues.callsOffered > 0 ? `${formatNumber(numericValues.callsHandled)} handled of ${formatNumber(numericValues.callsOffered)} offered` : "Requires Calls Offered"}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-1.5 block">Calls Offered</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.calls_offered} onChange={(e) => updateField("calls_offered", e.target.value)} placeholder="e.g. 520" />
          </div>
          <div>
            <Label className="mb-1.5 block">Calls Handled</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.calls} onChange={(e) => updateField("calls", e.target.value)} placeholder="e.g. 482" />
          </div>
          <div>
            <Label className="mb-1.5 block">Calls Abandoned</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.calls_abandoned} onChange={(e) => updateField("calls_abandoned", e.target.value)} placeholder="e.g. 38" />
          </div>
          <div>
            <Label className="mb-1.5 block">Average Handle Time</Label>
            <Input value={form.aht} onChange={(e) => updateField("aht", e.target.value)} placeholder="mm:ss, e.g. 4:32" />
          </div>
          <div>
            <Label className="mb-1.5 block">Average Wait Time</Label>
            <Input value={form.avg_wait} onChange={(e) => updateField("avg_wait", e.target.value)} placeholder="mm:ss, e.g. 1:12" />
          </div>
          <div>
            <Label className="mb-1.5 block">Emails Received</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" type="number" min="0" inputMode="numeric" value={form.emails_received} onChange={(e) => updateField("emails_received", e.target.value)} placeholder="e.g. 120" />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Emails Worked</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.emails_worked} onChange={(e) => updateField("emails_worked", e.target.value)} placeholder="e.g. 96" />
          </div>
          <div>
            <Label className="mb-1.5 block">Email Backlog at Start</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.email_backlog_start} onChange={(e) => updateField("email_backlog_start", e.target.value)} placeholder="e.g. 24" />
          </div>
          <div>
            <Label className="mb-1.5 block">Email Backlog at End</Label>
            <Input type="number" min="0" inputMode="numeric" value={form.email_backlog_end} onChange={(e) => updateField("email_backlog_end", e.target.value)} placeholder="e.g. 18" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Blank fields only leave existing saved values untouched for this date.
          </p>
          <Button onClick={handleSave} disabled={saving || !selectedDate}>
            {saving ? "Savingâ€¦" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
