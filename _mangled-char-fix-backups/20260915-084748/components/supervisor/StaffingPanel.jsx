import {useEffect, useMemo, useRef, useState} from "react";
import {toast} from "sonner";
import {UserCheck, Users} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {saveDailyMetric} from "@/features/supervisorDashboard/opsMetricsStore";
import {formatNumber} from "@/features/supervisorDashboard/format";

function blankForm() {
  return {
    team_headcount: "",
    staffing_scheduled: "",
    staffing_present: "",
    full_day_absences: "",
    partial_day_absences: "",
    training_capacity_loss: "",
    scheduled_productive_hours: "",
    actual_productive_hours: ""
  };
}

function recordToForm(record) {
  return {
    ...blankForm(),
    team_headcount: record?.team_headcount ?? "",
    staffing_scheduled: record?.staffing_scheduled ?? "",
    staffing_present: record?.staffing_present ?? "",
    full_day_absences: record?.full_day_absences ?? "",
    partial_day_absences: record?.partial_day_absences ?? "",
    training_capacity_loss: record?.training_capacity_loss ?? "",
    scheduled_productive_hours: record?.scheduled_productive_hours ?? "",
    actual_productive_hours: record?.actual_productive_hours ?? ""
  };
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeStaffingAvailabilityRate(staffingPresent, staffingScheduled) {
  if (!Number.isFinite(staffingPresent) || !Number.isFinite(staffingScheduled) || staffingScheduled <= 0) {
    return null;
  }
  return staffingPresent / staffingScheduled;
}

function Field({ id, label, value, onChange, placeholder, helperText }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">{label}</Label>
      <Input
        id={id}
        type="number"
        min="0"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {helperText ? <p className="mt-1 text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}

export default function StaffingPanel({ records = [], selectedDate, onChanged }) {
  const current = records.find(record => record.date === selectedDate);
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

  const availabilityRate = useMemo(() => {
    const staffingPresent = toNumberOrNull(form.staffing_present);
    const staffingScheduled = toNumberOrNull(form.staffing_scheduled);
    return computeStaffingAvailabilityRate(staffingPresent, staffingScheduled);
  }, [form.staffing_present, form.staffing_scheduled]);

  function updateField(key, value) {
    setForm(previous => ({ ...previous, [key]: value }));
    setIsDirty(true);
  }

  async function handleSave() {
    if (!selectedDate) {
      toast.error("Select a date before saving staffing.");
      return;
    }

    setSaving(true);
    try {
      await saveDailyMetric({
        date: selectedDate,
        team_headcount: toNumberOrNull(form.team_headcount),
        staffing_scheduled: toNumberOrNull(form.staffing_scheduled),
        staffing_present: toNumberOrNull(form.staffing_present),
        full_day_absences: toNumberOrNull(form.full_day_absences),
        partial_day_absences: toNumberOrNull(form.partial_day_absences),
        training_capacity_loss: toNumberOrNull(form.training_capacity_loss),
        scheduled_productive_hours: toNumberOrNull(form.scheduled_productive_hours),
        actual_productive_hours: toNumberOrNull(form.actual_productive_hours),
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved staffing metrics for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || "Could not save staffing metrics.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Staffing</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Manual entry from NICE CXONE Workforce Management.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary px-4 py-3 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected Date</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{selectedDate || "No date selected"}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Staffing Availability Rate</p>
              <p className="mt-1 text-3xl font-bold text-foreground">
                {availabilityRate !== null ? `${(availabilityRate * 100).toFixed(1)}%` : "N/A"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {availabilityRate !== null
                  ? `${formatNumber(toNumberOrNull(form.staffing_present))} available of ${formatNumber(toNumberOrNull(form.staffing_scheduled))} scheduled`
                  : "Shown only when Scheduled Staff is greater than zero."}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-secondary/60 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Keep Team Headcount separate from Available Staff</p>
              <p className="text-xs text-muted-foreground">
                Team Headcount means active employees assigned to the team.
              </p>
              <p className="text-xs text-muted-foreground">
                Available Staff means production capacity after absences and known partial-day impacts.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Team Assignment</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              id="team_headcount"
              label="Team Headcount"
              value={form.team_headcount}
              onChange={(value) => updateField("team_headcount", value)}
              placeholder="e.g. 24"
              helperText="Active employees assigned to the team"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Daily Availability</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              id="staffing_scheduled"
              label="Scheduled Staff"
              value={form.staffing_scheduled}
              onChange={(value) => updateField("staffing_scheduled", value)}
              placeholder="e.g. 18"
            />
            <Field
              id="staffing_present"
              label="Available Staff"
              value={form.staffing_present}
              onChange={(value) => updateField("staffing_present", value)}
              placeholder="e.g. 16"
            />
            <Field
              id="full_day_absences"
              label="Full-Day Absences"
              value={form.full_day_absences}
              onChange={(value) => updateField("full_day_absences", value)}
              placeholder="e.g. 2"
            />
            <Field
              id="partial_day_absences"
              label="Partial-Day Absences"
              value={form.partial_day_absences}
              onChange={(value) => updateField("partial_day_absences", value)}
              placeholder="e.g. 1"
            />
            <Field
              id="training_capacity_loss"
              label="Meetings/Training Capacity Loss"
              value={form.training_capacity_loss}
              onChange={(value) => updateField("training_capacity_loss", value)}
              placeholder="e.g. 6"
              helperText="hours or headcount-equivalent lost to meetings/training"
            />
            <Field
              id="scheduled_productive_hours"
              label="Scheduled Productive Hours"
              value={form.scheduled_productive_hours}
              onChange={(value) => updateField("scheduled_productive_hours", value)}
              placeholder="e.g. 126"
            />
            <Field
              id="actual_productive_hours"
              label="Actual Productive Hours"
              value={form.actual_productive_hours}
              onChange={(value) => updateField("actual_productive_hours", value)}
              placeholder="e.g. 112.5"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !selectedDate}>
            {saving ? "Savingâ€¦" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
