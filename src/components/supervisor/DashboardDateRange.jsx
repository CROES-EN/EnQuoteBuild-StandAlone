import {useEffect, useState} from "react";
import {CalendarRange, RotateCcw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {
    describeRangeCoverage,
    getPresetLabel,
    RANGE_PRESET_OPTIONS,
    RANGE_PRESETS,
    resolveDateRange,
    resolveDefaultPreset
} from "@/features/supervisorDashboard/dateRanges";
import {formatDateLabel} from "@/features/supervisorDashboard/format";

const CUSTOM = RANGE_PRESETS.CUSTOM_RANGE;
const ALL_HISTORY = RANGE_PRESETS.ALL_HISTORY;

function formatRangeLabel(range) {
  if (!range?.start || !range?.end) return "No dates selected";
  if (range.start === range.end) return formatDateLabel(range.start);
  return `${formatDateLabel(range.start)} \u2013 ${formatDateLabel(range.end)}`;
}

/**
 * The Executive Overview's reporting-period control: preset selector, start/end date, an
 * explicit Apply action (per spec, changes never auto-commit while the user is still editing
 * dates), Reset, the resolved period's label, and how many stored snapshots/missing calendar
 * dates fall inside it. This component never fabricates dates - it only resolves which range a
 * preset means and reports on `records` that already exist. The parent remembers only applied
 * selections (including Reset), not unapplied date edits, per signed-in user on this device.
 */
export default function DashboardDateRange({ records = [], value, onChange }) {
  const defaultPreset = resolveDefaultPreset(records);
  const committed = value || { preset: defaultPreset, start: null, end: null };

  const [pendingPreset, setPendingPreset] = useState(committed.preset);
  const [pendingStart, setPendingStart] = useState(committed.start || "");
  const [pendingEnd, setPendingEnd] = useState(committed.end || "");

  // Keep the pending inputs in sync if the parent's committed value changes from elsewhere
  // (e.g. Reset, or an initial default resolving once records finish loading).
  useEffect(() => {
    setPendingPreset(committed.preset);
    setPendingStart(committed.start || "");
    setPendingEnd(committed.end || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed.preset, committed.start, committed.end]);

  const previewRange = resolveDateRange({
    preset: pendingPreset,
    startDate: pendingStart || undefined,
    endDate: pendingEnd || undefined,
    records
  });

  const isDirty = pendingPreset !== committed.preset || previewRange.start !== committed.start || previewRange.end !== committed.end;
  const isCustom = pendingPreset === CUSTOM;
  const isAllHistory = pendingPreset === ALL_HISTORY;
  const startDisabled = !isCustom;
  const endDisabled = isAllHistory;
  const coverage = committed.start && committed.end ? describeRangeCoverage(records, committed) : null;

  function handlePresetChange(nextPreset) {
    setPendingPreset(nextPreset);
    if (nextPreset === CUSTOM) {
      // Seed Custom Range's editable inputs from whatever range the previous preset resolved to,
      // so switching to Custom Range doesn't blank out the dates the user was just looking at.
      setPendingStart(previewRange.start || "");
      setPendingEnd(previewRange.end || "");
    }
  }

  function handleApply() {
    const resolved = resolveDateRange({
      preset: pendingPreset,
      startDate: pendingStart || undefined,
      endDate: pendingEnd || undefined,
      records
    });
    onChange?.({ preset: pendingPreset, start: resolved.start, end: resolved.end });
  }

  function handleReset() {
    const resolved = resolveDateRange({ preset: defaultPreset, records });
    setPendingPreset(defaultPreset);
    setPendingStart(resolved.start || "");
    setPendingEnd(resolved.end || "");
    onChange?.({ preset: defaultPreset, start: resolved.start, end: resolved.end });
  }

  return (
    <Card className="border-border">
      <CardContent className="flex flex-wrap items-end gap-4 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarRange className="h-4 w-4" /> Reporting Period
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Preset</Label>
          <Select value={pendingPreset} onValueChange={handlePresetChange}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_PRESET_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Start date</Label>
          <Input
            type="date"
            className="w-40"
            disabled={startDisabled}
            value={isCustom ? pendingStart : (previewRange.start || "")}
            onChange={(e) => setPendingStart(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">End date</Label>
          <Input
            type="date"
            className="w-40"
            disabled={endDisabled}
            value={isAllHistory ? (previewRange.end || "") : pendingEnd || previewRange.end || ""}
            onChange={(e) => setPendingEnd(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleApply} disabled={!isDirty || previewRange.isInvalid}>Apply</Button>
          <Button size="sm" variant="outline" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
        </div>

        <div className="ml-auto flex flex-col items-end gap-0.5 text-right">
          <span className="text-sm font-medium text-foreground">
            {getPresetLabel(committed.preset)}: {formatRangeLabel(committed)}
          </span>
          {coverage && (
            <span className="text-xs text-muted-foreground">
              {coverage.snapshotCount} snapshot{coverage.snapshotCount === 1 ? "" : "s"} included
              {coverage.missingDateCount > 0 && ` \u00b7 ${coverage.missingDateCount} calendar date${coverage.missingDateCount === 1 ? "" : "s"} missing`}
            </span>
          )}
          {previewRange.isInvalid && isCustom && (
            <span className="text-xs font-medium text-rose-600">Start date is after end date - pick a valid range.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export { formatRangeLabel };
