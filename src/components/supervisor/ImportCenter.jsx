import { useMemo, useState } from "react";
import {
  CalendarClock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderInput,
  Info,
  Settings2,
  Upload
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  REPORT_DEFINITIONS,
  getFieldsForDefinition,
  getImportStatsForSource,
  downloadBlankTemplate,
  downloadSyntheticSample
} from "@/features/supervisorDashboard/reportDefinitions";
import { formatDateLabel } from "@/features/supervisorDashboard/format";
import {
  getHiddenFieldKeys,
  setFieldVisibility,
  resetFieldVisibility
} from "@/features/supervisorDashboard/columnPreferences";
import ColumnCustomizer from "@/components/supervisor/ColumnCustomizer";

const AVAILABLE_REPORTS = REPORT_DEFINITIONS.filter(def => def.schemaStatus === "configured");
const SETUP_REQUIRED_REPORTS = REPORT_DEFINITIONS.filter(def => def.schemaStatus === "setup_required");

/**
 * "Import Center" - a single, guided home for every report this Supervisor Dashboard can
 * import, per the O&M reporting spec's "Report Import Center" requirement. A report list on
 * the left drives a full instruction panel on the right (purpose, source system, accepted
 * formats, columns, unique key, import behavior, dashboards affected, and this report's own
 * last-import/record-count status), plus one-click blank/synthetic template downloads and a
 * button that opens the existing Import Report dialog pre-scoped to that report.
 *
 * This never changes how an import is actually parsed/aggregated/saved - it only makes the
 * existing ImportReportDialog + autoImportWatcher pipeline easier to find and understand.
 */
export default function ImportCenter({ records, onRequestImport }) {
  const [selectedId, setSelectedId] = useState(AVAILABLE_REPORTS[0]?.reportTypeId);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const selected = useMemo(
    () => REPORT_DEFINITIONS.find(def => def.reportTypeId === selectedId) || AVAILABLE_REPORTS[0],
    [selectedId]
  );
  const fields = useMemo(() => getFieldsForDefinition(selected), [selected]);
  const stats = useMemo(() => getImportStatsForSource(records, selected.reportTypeId), [records, selected]);
  const hiddenKeys = useMemo(() => getHiddenFieldKeys(selected.reportTypeId), [selected, prefsVersion]);

  function handleToggleFieldVisibility(fieldKey, visible) {
    setFieldVisibility(selected.reportTypeId, fieldKey, visible);
    setPrefsVersion(v => v + 1);
  }

  function handleResetVisibility() {
    resetFieldVisibility(selected.reportTypeId);
    setPrefsVersion(v => v + 1);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <FolderInput className="h-4 w-4" /> Available for Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            {AVAILABLE_REPORTS.map(def => (
              <ReportListButton key={def.reportTypeId} def={def} active={selected.reportTypeId === def.reportTypeId} onClick={() => setSelectedId(def.reportTypeId)} />
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Settings2 className="h-4 w-4" /> Setup Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            {SETUP_REQUIRED_REPORTS.map(def => (
              <ReportListButton key={def.reportTypeId} def={def} active={selected.reportTypeId === def.reportTypeId} onClick={() => setSelectedId(def.reportTypeId)} />
            ))}
          </CardContent>
        </Card>
      </div>

      <ReportInstructions
        definition={selected}
        fields={fields}
        stats={stats}
        onImportClick={() => onRequestImport?.(selected.reportTypeId)}
        onCustomizeClick={() => setShowCustomizer(true)}
      />

      <Dialog open={showCustomizer} onOpenChange={setShowCustomizer}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customize columns - {selected.displayName}</DialogTitle>
            <DialogDescription>
              Choose which metrics this report type offers to map during import. This never affects data already
              imported - only what a future import of this report offers to map - and can be changed back anytime.
            </DialogDescription>
          </DialogHeader>
          <ColumnCustomizer
            hiddenKeys={hiddenKeys}
            onToggle={handleToggleFieldVisibility}
            onReset={handleResetVisibility}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportListButton({ def, active, onClick }) {
  const setupRequired = def.schemaStatus === "setup_required";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {setupRequired ? <Settings2 className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
        {def.displayName}
      </span>
    </button>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[180px_1fr] sm:gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}

function ReportInstructions({ definition, fields, stats, onImportClick, onCustomizeClick }) {
  const setupRequired = definition.schemaStatus === "setup_required";

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl text-slate-900">{definition.displayName}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{definition.purpose}</p>
          </div>
          {setupRequired ? (
            <Badge variant="outline" className="whitespace-nowrap border-amber-300 bg-amber-50 text-amber-700">Setup Required</Badge>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="whitespace-nowrap border-emerald-300 bg-emerald-50 text-emerald-700">Ready to Import</Badge>
              <Button size="sm" onClick={onImportClick}>
                <Upload className="mr-2 h-4 w-4" /> Import
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {setupRequired ? (
          <Alert className="border-amber-200 bg-amber-50">
            <Settings2 className="h-4 w-4 text-amber-600" />
            <AlertTitle>No verified column list configured yet</AlertTitle>
            <AlertDescription className="text-amber-800">
              This report type is named in the O&amp;M reporting spec, but no source-file sample exists yet to
              confirm its real column names. Import is intentionally disabled here until an administrator
              configures the required mappings - nothing is guessed or invented in the meantime.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <InfoRow label="Source system">
              {definition.sourceSystem}
              {definition.sourceLink && (
                <a href={definition.sourceLink} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-indigo-600 hover:underline">
                  Open report <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </InfoRow>

            <InfoRow label="Accepted file formats">{definition.acceptedFileTypes.join(", ")}</InfoRow>

            {definition.importNotes && (
              <InfoRow label="Import notes">
                <span className="inline-flex items-start gap-1.5 text-slate-600">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
                  {definition.importNotes}
                </span>
              </InfoRow>
            )}

            <InfoRow label="Expected report name">
              {definition.expectedFileNames.length ? (
                <ul className="list-inside list-disc space-y-0.5">
                  {definition.expectedFileNames.map(name => <li key={name}>{name}</li>)}
                </ul>
              ) : "Not configured - any exported filename is accepted."}
            </InfoRow>

            <InfoRow label="Columns this report can fill in">
              <div className="flex flex-wrap gap-1.5">
                {fields.map(field => (
                  <Badge key={field.key} variant="outline" className="border-slate-200 text-slate-600">{field.label}</Badge>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Every column above is optional to map - "Not in this file" is always allowed - but at least one
                metric column, plus a date column (or a single date you choose for the whole file), must be
                mapped for an import to save anything.
              </p>
            </InfoRow>

            <InfoRow label="Unique record key">
              Calendar date (YYYY-MM-DD). One record exists per day - rows from this file that share a date are
              summed together, and re-importing later only updates the columns you map that time, leaving every
              other field for that day untouched.
            </InfoRow>

            <InfoRow label="Accepted date formats">
              Any native Excel date, or a plain text date such as YYYY-MM-DD or MM/DD/YYYY. If the file has no
              date column at all, you'll be asked to pick one date to apply to every row before importing.
            </InfoRow>

            <InfoRow label="Import strategy / duplicate behavior">
              Mapped numeric columns are summed across every row sharing a date (call/wait times are averaged,
              weighted by call volume). Re-importing the same day never creates a duplicate day - it merges into
              the existing record, so a second file covering different columns for the same date adds to it
              instead of overwriting it.
            </InfoRow>

            <InfoRow label="Dashboards affected">
              <div className="flex flex-wrap gap-1.5">
                {definition.dashboardsAffected.map(name => <Badge key={name} variant="secondary">{name}</Badge>)}
              </div>
            </InfoRow>

            {definition.exampleMappings.length > 0 && (
              <InfoRow label="Example field mappings">
                <ul className="space-y-0.5">
                  {definition.exampleMappings.map(m => (
                    <li key={m.source} className="text-sm text-slate-600">
                      <span className="font-mono text-xs text-slate-500">"{m.source}"</span> → {m.target}
                    </li>
                  ))}
                </ul>
              </InfoRow>
            )}

            <InfoRow label="Last successful import">
              {stats.lastImportedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                  {new Date(stats.lastImportedAt).toLocaleString()}
                </span>
              ) : "No import recorded yet for this report."}
            </InfoRow>

            <InfoRow label="Current reporting period">
              {stats.earliestDate ? (
                <>
                  {formatDateLabel(stats.earliestDate)} – {formatDateLabel(stats.latestDate)}
                  <span className="ml-1 text-xs text-slate-400">(dates this report has imported data for)</span>
                </>
              ) : "No data imported yet for this report."}
            </InfoRow>

            <InfoRow label="Current record count">
              {stats.recordCount} day{stats.recordCount === 1 ? "" : "s"} of data currently carry a "{definition.reportTypeId}" import tag
              {stats.totalRowsImported > 0 && ` (${stats.totalRowsImported} source row${stats.totalRowsImported === 1 ? "" : "s"} imported in total)`}.
            </InfoRow>
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {!setupRequired && (
            <>
              <Button onClick={onImportClick}>
                <Upload className="mr-2 h-4 w-4" /> Import This Report
              </Button>
              <Button variant="outline" onClick={() => downloadBlankTemplate(definition)}>
                <Download className="mr-2 h-4 w-4" /> Download Blank Template
              </Button>
              <Button variant="outline" onClick={() => downloadSyntheticSample(definition)}>
                <Download className="mr-2 h-4 w-4" /> Download Synthetic Example
              </Button>
              <Button variant="outline" onClick={onCustomizeClick}>
                <Settings2 className="mr-2 h-4 w-4" /> Customize Columns
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
