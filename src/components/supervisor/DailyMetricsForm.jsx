import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PenLine } from "lucide-react";
import { saveDailyMetric } from "@/features/supervisorDashboard/opsMetricsStore";
import { parseDurationToSeconds } from "@/features/supervisorDashboard/reportParsing";
import { formatSecondsAsClock } from "@/features/supervisorDashboard/format";

function blankForm(date) {
  return {
    date: date || new Date().toISOString().slice(0, 10),
    calls: "",
    aht: "",
    emails_worked: "",
    quotes_drafted: "",
    staffing_present: "",
    staffing_scheduled: "",
    notes: ""
  };
}

function recordToForm(record) {
  return {
    date: record.date,
    calls: record.calls ?? "",
    aht: record.aht_seconds !== null && record.aht_seconds !== undefined ? formatSecondsAsClock(record.aht_seconds) : "",
    emails_worked: record.emails_worked ?? "",
    quotes_drafted: record.quotes_drafted ?? "",
    staffing_present: record.staffing_present ?? "",
    staffing_scheduled: record.staffing_scheduled ?? "",
    notes: record.notes ?? ""
  };
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Add/edit dialog for a single day's Supervisor Dashboard metrics. Used both
 * for manual-only entry and for correcting/annotating a day that already has
 * imported data (existing fields are pre-filled from the current record).
 */
export default function DailyMetricsForm({ open, onOpenChange, editingRecord, onSaved }) {
  const [form, setForm] = useState(() => (editingRecord ? recordToForm(editingRecord) : blankForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(editingRecord ? recordToForm(editingRecord) : blankForm());
      setError("");
    }
  }, [open, editingRecord]);

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.date) { setError("A date is required."); return; }

    const ahtSeconds = form.aht.trim() ? parseDurationToSeconds(form.aht.trim()) : null;
    if (form.aht.trim() && ahtSeconds === null) {
      setError('AHT must look like "4:32" (mm:ss) or a number of seconds.');
      return;
    }

    setSaving(true); setError("");
    try {
      await saveDailyMetric({
        date: form.date,
        calls: toNumberOrNull(form.calls),
        aht_seconds: ahtSeconds,
        emails_worked: toNumberOrNull(form.emails_worked),
        quotes_drafted: toNumberOrNull(form.quotes_drafted),
        staffing_present: toNumberOrNull(form.staffing_present),
        staffing_scheduled: toNumberOrNull(form.staffing_scheduled),
        notes: form.notes || "",
        sources: { manual: { imported_at: new Date().toISOString() } }
      });
      toast.success(`Saved metrics for ${form.date}`);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Could not save these metrics.");
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="w-5 h-5 text-indigo-600" />
            {editingRecord ? `Edit metrics — ${editingRecord.date}` : "Add daily metrics"}
          </DialogTitle>
          <DialogDescription>
            Fields left blank won't overwrite any value already saved for this day from an import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-1.5 block">Date</Label>
            <Input
              type="date"
              value={form.date}
              disabled={Boolean(editingRecord)}
              onChange={(e) => updateField("date", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Calls Handled</Label>
              <Input type="number" min="0" inputMode="numeric" value={form.calls} onChange={(e) => updateField("calls", e.target.value)} placeholder="e.g. 482" />
            </div>
            <div>
              <Label className="mb-1.5 block">Average Handle Time</Label>
              <Input value={form.aht} onChange={(e) => updateField("aht", e.target.value)} placeholder="mm:ss, e.g. 4:32" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Emails Worked</Label>
              <Input type="number" min="0" inputMode="numeric" value={form.emails_worked} onChange={(e) => updateField("emails_worked", e.target.value)} placeholder="e.g. 96" />
            </div>
            <div>
              <Label className="mb-1.5 block">Quotes Drafted</Label>
              <Input type="number" min="0" inputMode="numeric" value={form.quotes_drafted} onChange={(e) => updateField("quotes_drafted", e.target.value)} placeholder="e.g. 34" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Staffing (present)</Label>
              <Input type="number" min="0" inputMode="numeric" value={form.staffing_present} onChange={(e) => updateField("staffing_present", e.target.value)} placeholder="e.g. 9" />
            </div>
            <div>
              <Label className="mb-1.5 block">Staffing (scheduled)</Label>
              <Input type="number" min="0" inputMode="numeric" value={form.staffing_scheduled} onChange={(e) => updateField("staffing_scheduled", e.target.value)} placeholder="e.g. 10" />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Callouts, escalations, context for the numbers above…" />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
