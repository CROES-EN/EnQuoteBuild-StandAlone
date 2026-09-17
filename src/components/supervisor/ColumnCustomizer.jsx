import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FIELD_DEFINITIONS } from "@/features/supervisorDashboard/reportParsing";

/**
 * Lets a user hide metrics they never map for a given report type, from the FULL field list (not
 * an already-filtered one) so a previously-hidden field can be found and re-shown again here.
 * Shared between ImportReportDialog (inline, while actively importing) and ImportCenter (a
 * standalone "Customize Columns" action, editable anytime without starting an import) - both
 * read/write the same per-source preferences via columnPreferences.js.
 */
export default function ColumnCustomizer({ hiddenKeys, onToggle, onReset }) {
  const fields = useMemo(() => FIELD_DEFINITIONS.filter(f => f.group !== "Row Identification"), []);
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="flex items-center justify-between mb-2 gap-3">
        <p className="text-xs text-muted-foreground">
          Uncheck a metric you never use for this report type to hide it here going forward - safe to change your
          mind anytime.
        </p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onReset}>Show all</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 max-h-56 overflow-auto">
        {fields.map(field => (
          <label key={field.key} className="flex items-center gap-2 text-sm text-foreground py-0.5 cursor-pointer">
            <Checkbox
              checked={!hiddenKeys.has(field.key)}
              onCheckedChange={(checked) => onToggle(field.key, checked === true)}
            />
            {field.label}
          </label>
        ))}
      </div>
    </div>
  );
}
