import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateLabel, formatNumber } from "@/features/supervisorDashboard/format";

const SOURCE_LABELS = {
  cxone: "CXONE import",
  nice_wfm: "NICE WFM import",
  salesforce: "Salesforce import",
  incorta: "Incorta import",
  care_tracker: "Care Tracker import",
  escalations_tracker: "Escalations Tracker import",
  manual: "Manual entry",
  other: "Other import"
};

function describeSources(record) {
  const sources = record?.sources || {};
  const keys = Object.keys(sources).filter(key => SOURCE_LABELS[key]);
  if (!keys.length) return ["No source recorded"];
  return keys.map(key => SOURCE_LABELS[key]);
}

/**
 * Drill-down panel: lists the underlying daily record(s) that produced a KPI/chart value the
 * user clicked on, per spec - date, the field's raw value, and which source(s) contributed it
 * (manual vs a named import), so a figure is never a dead end.
 *
 * `fieldKey`/`fieldLabel` describe which single field this drill-down is about; `records` should
 * already be filtered to the relevant range (or a single date, for a single KPI/chart-point
 * click) by the caller.
 */
export default function DrillDownDrawer({ open, onOpenChange, title, fieldKey, fieldLabel, records = [] }) {
  const rows = [...records]
    .filter(record => record?.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title || "Contributing Records"}</SheetTitle>
          <SheetDescription>
            {fieldLabel ? `Every stored daily record contributing to "${fieldLabel}" in the selected period.` : "Every stored daily record in the selected period."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No stored records contribute to this value.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {fieldKey && <TableHead className="text-right">Value</TableHead>}
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(record => {
                  const value = fieldKey ? record?.[fieldKey] : undefined;
                  const hasValue = value !== null && value !== undefined;
                  return (
                    <TableRow key={record.date}>
                      <TableCell className="whitespace-nowrap">{formatDateLabel(record.date)}</TableCell>
                      {fieldKey && (
                        <TableCell className="text-right">{hasValue ? formatNumber(value) : "—"}</TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {describeSources(record).map(label => (
                            <Badge key={label} variant="outline" className="border-slate-200 text-xs text-slate-600">{label}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
