import {useEffect, useRef, useState} from "react";
import {HeartHandshake} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {saveDailyMetric} from "@/features/supervisorDashboard/opsMetricsStore";

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordToForm(record) {
  return {
    care_appt_cancellations: record?.care_appt_cancellations ?? "",
    care_plan_cancellation_requests: record?.care_plan_cancellation_requests ?? "",
    care_cancellations_completed: record?.care_cancellations_completed ?? "",
    care_refunds_initiated: record?.care_refunds_initiated ?? ""
  };
}

export default function EnphaseCarePanel({ records, selectedDate, onChanged }) {
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
        care_appt_cancellations: toNumberOrNull(form.care_appt_cancellations),
        care_plan_cancellation_requests: toNumberOrNull(form.care_plan_cancellation_requests),
        care_cancellations_completed: toNumberOrNull(form.care_cancellations_completed),
        care_refunds_initiated: toNumberOrNull(form.care_refunds_initiated),
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved Enphase Care metrics for ${selectedDate}`);
      setIsDirty(false);
      onChanged?.();
    } catch (error) {
      toast.error(error.message || "Could not save Enphase Care metrics.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="h-5 w-5 text-rose-600" />
          Enphase Care
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">Care Appointment Cancellations</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.care_appt_cancellations}
              onChange={(event) => updateField("care_appt_cancellations", event.target.value)}
              placeholder="e.g. 6"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Care Plan Cancellation Requests</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.care_plan_cancellation_requests}
              onChange={(event) => updateField("care_plan_cancellation_requests", event.target.value)}
              placeholder="e.g. 4"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1.5 block">Care Cancellations Completed</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.care_cancellations_completed}
              onChange={(event) => updateField("care_cancellations_completed", event.target.value)}
              placeholder="e.g. 3"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Care Refunds Initiated</Label>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={form.care_refunds_initiated}
              onChange={(event) => updateField("care_refunds_initiated", event.target.value)}
              placeholder="e.g. 2"
            />
          </div>
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
