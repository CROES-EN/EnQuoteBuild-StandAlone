import { CheckCircle2, FileSpreadsheet, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * ImportProgressScreen - shows the real (not simulated) stages of committing an
 * already-previewed/validated import to opsMetricsStore, then a completion
 * summary of exactly what was saved. Mapping, validation, and preview happen
 * earlier in ImportReportDialog before this component ever renders - this
 * covers only the "Saving Records" -> "Complete" portion, since that is the
 * only step here that does real asynchronous work worth showing progress for.
 *
 * Stage transitions are driven by actual awaited work completing in the
 * caller (ImportReportDialog's handleImport), never by a timer - if saving
 * finishes in under a second, this simply renders "Complete" quickly, which
 * is honest: nothing here fabricates elapsed time or a fake percentage.
 */
const STAGES = [
  { key: "saving", label: "Saving Records" },
  { key: "complete", label: "Complete" }
];

function StageRow({ stage, currentStage }) {
  const stageIndex = STAGES.findIndex((s) => s.key === stage.key);
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);
  const isDone = currentIndex > stageIndex || currentStage === "complete";
  const isActive = stage.key === currentStage && currentStage !== "complete";

  return (
    <div className="flex items-center gap-2 text-sm">
      {isDone ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : isActive ? (
        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
      ) : (
        <span className="h-4 w-4 rounded-full border border-slate-300" />
      )}
      <span
        className={
          isDone
            ? "text-foreground"
            : isActive
            ? "font-medium text-indigo-700"
            : "text-muted-foreground"
        }
      >
        {stage.label}
      </span>
    </div>
  );
}

export default function ImportProgressScreen({
  stage,
  fileName,
  totalRows,
  newDateCount,
  updatedDateCount,
  warnings = [],
  onClose,
  onImportAnother
}) {
  const isComplete = stage === "complete";

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
          {isComplete ? "Import Complete" : "Importing Report"}
        </CardTitle>
        <p className="truncate text-sm text-muted-foreground">{fileName}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {STAGES.map((s) => (
            <StageRow key={s.key} stage={s} currentStage={stage} />
          ))}
        </div>

        {isComplete && (
          <>
            <div className="grid grid-cols-3 gap-3 border-t pt-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Days Saved
                </p>
                <p className="text-lg font-semibold text-foreground">
                  {newDateCount + updatedDateCount}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  New Dates
                </p>
                <p className="text-lg font-semibold text-emerald-700">{newDateCount}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Updated Dates
                </p>
                <p className="text-lg font-semibold text-indigo-700">{updatedDateCount}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {totalRows} source row{totalRows === 1 ? "" : "s"} processed from this file.
              "Updated" means a record already existed for that date and the columns you mapped
              this time were merged into it - fields not mapped in this import were left
              untouched.
            </p>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" /> {warnings.length} row
                  {warnings.length === 1 ? "" : "s"} skipped
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-800">
                  {warnings.slice(0, 5).map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button onClick={onClose}>Close</Button>
              <Button variant="outline" onClick={onImportAnother}>
                Import Another Report
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
