import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveDailyMetric } from "@/features/supervisorDashboard/opsMetricsStore";

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordToForm(record) {
  return {
    new_s1: record?.new_s1 ?? "",
    new_s2: record?.new_s2 ?? "",
    new_s3: record?.new_s3 ?? "",
    open_critical_escalations: record?.open_critical_escalations ?? "",
    overdue_follow_ups: record?.overdue_follow_ups ?? "",
    major_blockers: record?.major_blockers ?? "",
    leadership_action_required: record?.leadership_action_required ?? "",
    travel_field_blockers: record?.travel_field_blockers ?? ""
  };
}

export default function EscalationsPanel({ records, selectedDate, onChanged }) {
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
        new_s1: toNumberOrNull(form.new_s1),
        new_s2: toNumberOrNull(form.new_s2),
        new_s3: toNumberOrNull(form.new_s3),
        open_critical_escalations: toNumberOrNull(form.open_critical_escalations),
        overdue_follow_ups: toNumberOrNull(form.overdue_follow_ups),
        major_blockers: form.major_blockers,
        leadership_action_required: form.leadership_action_required,
        travel_field_blockers: form.travel_field_blockers,
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved escalation metrics for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error.message || "Could not save escalation metrics.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="h-5 w-5 text-amber-600" />
          Blockers &amp; Escalations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">New S1 Escalations</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.new_s1}
              onChange={(event) => updateField("new_s1", event.target.value)}
              placeholder="e.g. 1"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">New S2 Escalations</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.new_s2}
              onChange={(event) => updateField("new_s2", event.target.value)}
              placeholder="e.g. 3"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">New S3 Escalations</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.new_s3}
              onChange={(event) => updateField("new_s3", event.target.value)}
              placeholder="e.g. 5"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Open Critical Escalations</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.open_critical_escalations}
              onChange={(event) => updateField("open_critical_escalations", event.target.value)}
              placeholder="e.g. 2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">Overdue Follow-Ups</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.overdue_follow_ups}
              onChange={(event) => updateField("overdue_follow_ups", event.target.value)}
              placeholder="e.g. 4"
            />
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">Major Operational Blockers</Label>
          <Textarea
            value={form.major_blockers}
            onChange={(event) => updateField("major_blockers", event.target.value)}
            placeholder="Describe any major blockers affecting O&M operationsâ€¦"
          />
        </div>

        <div>
          <Label className="mb-1.5 block">Leadership Action Required</Label>
          <Textarea
            value={form.leadership_action_required}
            onChange={(event) => updateField("leadership_action_required", event.target.value)}
            placeholder="Anything leadership needs to act on todayâ€¦"
          />
        </div>

        <div>
          <Label className="mb-1.5 block">Travel / Field Coverage Blockers</Label>
          <p className="mb-1.5 text-xs text-muted-foreground">
            From the Travel Plan Tracker â€” travel plans awaiting approval, field coverage limitations, staffing conflicts
          </p>
          <Textarea
            value={form.travel_field_blockers}
            onChange={(event) => updateField("travel_field_blockers", event.target.value)}
            placeholder="Any travel-related blockers affecting significant O&M workâ€¦"
          />
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
