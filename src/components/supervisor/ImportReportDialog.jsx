import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, Settings2 } from "lucide-react";
import {
  FIELD_DEFINITIONS,
  peekReportFile,
  readPeekedSheet,
  readPeekedSheets,
  guessHeaderRowIndex,
  buildColumnOptions,
  autoMapColumns,
  aggregateRowsByDate
} from "@/features/supervisorDashboard/reportParsing";
import { saveDailyMetric, listDailyMetrics } from "@/features/supervisorDashboard/opsMetricsStore";
import { formatSecondsAsClock } from "@/features/supervisorDashboard/format";
import { setLastImportedFile } from "@/features/supervisorDashboard/lastImportedFile";
import {
  getEffectiveFieldDefinitions,
  getHiddenFieldKeys,
  setFieldVisibility,
  resetFieldVisibility
} from "@/features/supervisorDashboard/columnPreferences";
import ColumnCustomizer from "@/components/supervisor/ColumnCustomizer";
import ImportProgressScreen from "@/components/supervisor/ImportProgressScreen";

const SOURCE_OPTIONS = [
  { value: "cxone", label: "CXONE / NICE Report (Contact Center)" },
  { value: "nice_wfm", label: "NICE CXONE Workforce Management (Staffing)" },
  { value: "salesforce", label: "Salesforce Report (Quote Requests)" },
  { value: "incorta", label: "Incorta Dashboard Export (O&M Scheduling / Case Backlog)" },
  { value: "care_tracker", label: "Enphase Care / SVCancelTracker Export" },
  { value: "escalations_tracker", label: "Escalations / O&M Tracker Export" },
  { value: "other", label: "Other / Manual Export" }
];

const NONE_VALUE = "__none__";

// Groups a list of FIELD_DEFINITIONS by their `group` property, preserving first-appearance
// order, so the "Map columns to metrics" UI can render one labeled section per report area.
function groupFieldDefinitions(fieldDefinitions) {
  const groups = [];
  const byName = new Map();
  fieldDefinitions.forEach((field) => {
    const groupName = field.group || "Other";
    if (!byName.has(groupName)) {
      const group = { name: groupName, fields: [] };
      byName.set(groupName, group);
      groups.push(group);
    }
    byName.get(groupName).fields.push(field);
  });
  return groups;
}

// The "aht" FIELD_DEFINITIONS key maps to the aggregated record's `aht_seconds` output field
// (named that way for clarity elsewhere in this feature) - every other field's key matches its
// output field name exactly.
function outputKeyForField(field) {
  return field.key === "aht" ? "aht_seconds" : field.key;
}

export default function ImportReportDialog({ open, onOpenChange, onImported, initialSource }) {
  const [source, setSource] = useState(initialSource || "cxone");
  const [fileName, setFileName] = useState("");
  const [filePath, setFilePath] = useState("");
  // Result of peekReportFile() - { kind, sheetNames, _buffer|_text } - null until a file is chosen.
  const [peeked, setPeeked] = useState(null);
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState({});
  const [fallbackDate, setFallbackDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [showCustomizer, setShowCustomizer] = useState(false);

  // Real (non-simulated) import stage tracking for ImportProgressScreen - null while the user is
  // still choosing/mapping/previewing, "saving" while saveDailyMetric calls are in flight,
  // "complete" once every record has been saved. Never driven by a timer.
  const [importStage, setImportStage] = useState(null);
  const [importSummary, setImportSummary] = useState(null);

  // Bumped whenever column-visibility preferences change, to force the memos below (which read
  // localStorage, not React state) to recompute.
  const [prefsVersion, setPrefsVersion] = useState(0);

  // Re-applies the caller's requested report type each time the dialog opens (e.g. the Import
  // Center's "Import This Report" button), so it stays scoped to whichever report the user
  // picked instead of always reopening on the last-used source.
  useEffect(() => {
    if (open && initialSource) setSource(initialSource);
  }, [open, initialSource]);

  const effectiveFieldDefinitions = useMemo(
    () => getEffectiveFieldDefinitions(FIELD_DEFINITIONS, source),
    [source, prefsVersion]
  );
  const fieldGroups = useMemo(() => groupFieldDefinitions(effectiveFieldDefinitions), [effectiveFieldDefinitions]);
  const hiddenKeys = useMemo(() => getHiddenFieldKeys(source), [source, prefsVersion]);

  const columnOptions = useMemo(
    () => (rawRows.length ? buildColumnOptions(rawRows, headerRowIndex) : []),
    [rawRows, headerRowIndex]
  );

  const hasDateColumn = mapping.date !== null && mapping.date !== undefined;
  const isMultiSheet = selectedSheetNames.length > 1;

  // Only preview columns for fields actually mapped in this import - with 30+ possible fields
  // across every tab, always showing every column (mostly "-") would make the preview unusable.
  const previewFields = useMemo(
    () =>
      effectiveFieldDefinitions.filter(
        (field) => field.key !== "date" && field.key !== "agent" && mapping[field.key] !== null && mapping[field.key] !== undefined
      ),
    [effectiveFieldDefinitions, mapping]
  );

  const aggregation = useMemo(() => {
    if (!rawRows.length || !columnOptions.length) return null;
    return aggregateRowsByDate({
      rows: rawRows,
      headerRowIndex,
      mapping,
      fallbackDate: hasDateColumn ? null : fallbackDate,
      source
    });
  }, [rawRows, headerRowIndex, mapping, hasDateColumn, fallbackDate, source]);

  function resetState() {
    setFileName("");
    setFilePath("");
    setPeeked(null);
    setSelectedSheetNames([]);
    setRawRows([]);
    setHeaderRowIndex(0);
    setMapping({});
    setError("");
    setShowCustomizer(false);
    setImportStage(null);
    setImportSummary(null);
  }

  function applyMappingForRows(rows, guessedHeaderRow, fieldDefs) {
    const columns = buildColumnOptions(rows, guessedHeaderRow);
    setRawRows(rows);
    setHeaderRowIndex(guessedHeaderRow);
    setMapping(autoMapColumns(columns, fieldDefs));
  }

  async function handleFileChosen(file) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const peekedFile = await peekReportFile(file);
      setFileName(file.name);
      // `file.path` is only ever populated inside the Electron desktop app - plain browsers
      // never expose a local file's absolute path via <input type="file">, so this is simply
      // empty there and the "reopen this file" shortcut stays hidden, as expected.
      setFilePath(file.path || "");
      setPeeked(peekedFile);
      if (peekedFile.sheetNames.length <= 1) {
        // Only one tab/section exists - nothing to choose, so parse it immediately instead of
        // making the user confirm a selection of one (matches this dialog's existing
        // zero-friction behavior for simple single-sheet files).
        const only = peekedFile.sheetNames[0];
        setSelectedSheetNames(only ? [only] : []);
        if (only) {
          const rows = readPeekedSheet(peekedFile, only);
          applyMappingForRows(rows, guessHeaderRowIndex(rows), effectiveFieldDefinitions);
        }
      } else {
        setSelectedSheetNames([]);
      }
    } catch (err) {
      setError(err.message || "This file could not be read. Confirm it's a valid .xlsx, .xls, .csv, or .html export.");
    }
    setLoading(false);
  }

  function toggleSheet(name, checked) {
    setSelectedSheetNames((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  function handleContinueWithSheets() {
    if (!peeked || !selectedSheetNames.length) return;
    setLoading(true);
    setError("");
    try {
      if (selectedSheetNames.length === 1) {
        const rows = readPeekedSheet(peeked, selectedSheetNames[0]);
        applyMappingForRows(rows, guessHeaderRowIndex(rows), effectiveFieldDefinitions);
      } else {
        const { rows, headerRowIndex: idx } = readPeekedSheets(peeked, selectedSheetNames);
        applyMappingForRows(rows, idx, effectiveFieldDefinitions);
      }
    } catch (err) {
      setError(err.message || "Could not read the selected tab(s)/section(s).");
    }
    setLoading(false);
  }

  // Goes back to the tab/section picker without discarding the already-peeked file.
  function handleChangeTabs() {
    setRawRows([]);
    setHeaderRowIndex(0);
    setMapping({});
    setError("");
  }

  function handleHeaderRowChange(nextIndex) {
    const columns = buildColumnOptions(rawRows, nextIndex);
    setHeaderRowIndex(nextIndex);
    setMapping(autoMapColumns(columns, effectiveFieldDefinitions));
  }

  function handleToggleFieldVisibility(fieldKey, visible) {
    setFieldVisibility(source, fieldKey, visible);
    if (!visible) {
      // Hiding a field that's currently mapped clears its mapping too, so a hidden field can
      // never keep quietly importing data behind the scenes.
      setMapping((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
    setPrefsVersion((v) => v + 1);
  }

  function handleResetVisibility() {
    resetFieldVisibility(source);
    setPrefsVersion((v) => v + 1);
  }

  async function handleImport() {
    if (!aggregation?.records?.length) return;
    setImporting(true);
    setImportStage("saving");
    try {
      // Determine, BEFORE saving anything, which of this import's dates already have a stored
      // record - this is the only reliable way to report "New" vs "Updated" per date, since
      // opsMetricsStore's merge is deliberately silent (it never returns whether it created or
      // updated a record). Reading existing state first never mutates anything.
      const existingRecords = await listDailyMetrics();
      const existingDates = new Set(existingRecords.map((r) => r.date));

      let newDateCount = 0;
      let updatedDateCount = 0;

      for (const record of aggregation.records) {
        if (existingDates.has(record.date)) {
          updatedDateCount += 1;
        } else {
          newDateCount += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await saveDailyMetric(record);
      }

      setLastImportedFile({ name: fileName, path: filePath, source });

      setImportSummary({
        newDateCount,
        updatedDateCount,
        totalRows: aggregation.totalRowsProcessed,
        warnings: aggregation.warnings
      });
      setImportStage("complete");

      toast.success(
        `Imported ${aggregation.records.length} day${aggregation.records.length === 1 ? "" : "s"} from ${fileName}`
      );
      onImported?.();
    } catch (err) {
      setImportStage(null);
      toast.error(err.message || "Import failed.");
    }
    setImporting(false);
  }

  function handleCloseAfterComplete() {
    onOpenChange(false);
    resetState();
  }

  function handleImportAnother() {
    resetState();
  }

  const showSheetPicker = Boolean(peeked && !rawRows.length && peeked.sheetNames.length > 1);
  const showProgressScreen = Boolean(importStage);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetState();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
            Import Report
          </DialogTitle>
          {!showProgressScreen && (
            <DialogDescription>
              Upload a CXONE/NICE, Salesforce, Incorta (spreadsheet or HTML dashboard export), Enphase Care, or
              escalations tracker report export (.xlsx, .xls, .csv, .html, or .htm). Map its columns to the metrics
              below - imports are paired by date, so separate files covering different tabs for the same day combine
              instead of overwriting each other. See the <strong>Import Center</strong> tab for full per-report
              instructions, blank templates, and synthetic sample files.
            </DialogDescription>
          )}
        </DialogHeader>

        {showProgressScreen && (
          <ImportProgressScreen
            stage={importStage}
            fileName={fileName}
            totalRows={importSummary?.totalRows ?? 0}
            newDateCount={importSummary?.newDateCount ?? 0}
            updatedDateCount={importSummary?.updatedDateCount ?? 0}
            warnings={importSummary?.warnings ?? []}
            onClose={handleCloseAfterComplete}
            onImportAnother={handleImportAnother}
          />
        )}

        {!showProgressScreen && !peeked && (
          <div className="space-y-4 py-6">
            <div>
              <Label className="mb-2 block">Report type</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.html,.htm"
              className="hidden"
              id="supervisor-report-file-input"
              onChange={(event) => event.target.files?.[0] && handleFileChosen(event.target.files[0])}
            />
            <Button
              className="w-full"
              disabled={loading}
              onClick={() => document.getElementById("supervisor-report-file-input")?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {loading ? "Reading file..." : "Choose Report File"}
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Couldn't read file</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {!showProgressScreen && showSheetPicker && (
          <div className="space-y-4 py-6">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">File</Label>
              <p className="text-sm font-medium text-foreground">{fileName}</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold text-foreground">
                {peeked.kind === "html" ? "Select the dashboard section(s) to import" : "Select the tab(s) to import"}
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                Only the tab(s)/section(s) you check are read - everything else in this file is left untouched, so
                a large workbook or dashboard export never slows things down over what you actually need. Select
                more than one only when they share the same columns (e.g. several same-shaped weekly tabs).
              </p>
              <div className="max-h-72 divide-y overflow-auto rounded-lg border">
                {peeked.sheetNames.map((name) => (
                  <label key={name} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    <Checkbox
                      checked={selectedSheetNames.includes(name)}
                      onCheckedChange={(checked) => toggleSheet(name, checked === true)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Couldn't read selection</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button onClick={handleContinueWithSheets} disabled={loading || !selectedSheetNames.length}>
                {loading ? "Reading..." : `Continue with ${selectedSheetNames.length || ""} selected`}
              </Button>
              <Button variant="outline" onClick={resetState}>
                Choose a different file
              </Button>
            </div>
          </div>
        )}

        {!showProgressScreen && rawRows.length > 0 && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">File</Label>
                <p className="text-sm font-medium text-foreground">{fileName}</p>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{peeked?.kind === "html" ? "Section(s)" : "Tab(s)"}</Label>
                <p className="max-w-xs truncate text-sm text-foreground" title={selectedSheetNames.join(", ")}>
                  {selectedSheetNames.join(", ")}
                </p>
              </div>
              {!isMultiSheet && (
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Header row</Label>
                  <Select value={String(headerRowIndex)} onValueChange={(v) => handleHeaderRowChange(Number(v))}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {rawRows.slice(0, 15).map((row, index) => (
                        <SelectItem key={index} value={String(index)}>
                          Row {index + 1}: {row.filter(Boolean).slice(0, 3).join(", ") || "(blank)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {peeked?.sheetNames?.length > 1 && (
                <Button variant="outline" size="sm" onClick={handleChangeTabs}>
                  Change tabs
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={resetState}>
                Choose a different file
              </Button>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Map columns to metrics</p>
                <Button variant="ghost" size="sm" onClick={() => setShowCustomizer((v) => !v)}>
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  Customize columns
                </Button>
              </div>
              {showCustomizer && (
                <div className="mb-4">
                  <ColumnCustomizer hiddenKeys={hiddenKeys} onToggle={handleToggleFieldVisibility} onReset={handleResetVisibility} />
                </div>
              )}
              <div className="space-y-4">
                {fieldGroups.map((group) => (
                  <div key={group.name}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {group.fields.map((field) => (
                        <div key={field.key} className="flex items-center gap-3">
                          <Label className="w-44 shrink-0 text-sm text-muted-foreground">{field.label}</Label>
                          <Select
                            value={mapping[field.key] === null || mapping[field.key] === undefined ? NONE_VALUE : String(mapping[field.key])}
                            onValueChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v === NONE_VALUE ? null : Number(v) }))}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_VALUE}>Not in this file</SelectItem>
                              {columnOptions.map((col) => (
                                <SelectItem key={col.index} value={String(col.index)}>
                                  {col.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!hasDateColumn && (
              <div>
                <Label className="mb-1.5 block text-sm text-muted-foreground">No date column mapped - apply every row to this date:</Label>
                <Input type="date" value={fallbackDate} onChange={(e) => setFallbackDate(e.target.value)} className="w-48" />
              </div>
            )}

            {aggregation && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">
                  Preview - {aggregation.records.length} day{aggregation.records.length === 1 ? "" : "s"} of data
                  {aggregation.totalRowsSkipped > 0 && (
                    <span className="ml-2 font-normal text-amber-600">({aggregation.totalRowsSkipped} row(s) skipped)</span>
                  )}
                </p>
                <div className="max-h-56 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        {previewFields.map((field) => (
                          <TableHead key={field.key}>{field.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aggregation.records.map((record) => (
                        <TableRow key={record.date}>
                          <TableCell className="font-medium">{record.date}</TableCell>
                          {previewFields.map((field) => {
                            const value = record[outputKeyForField(field)];
                            return (
                              <TableCell key={field.key}>
                                {field.valueType === "duration" ? formatSecondsAsClock(value) : value ?? "-"}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                      {aggregation.records.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={previewFields.length + 1} className="py-6 text-center text-muted-foreground">
                            No rows matched - check your column mapping.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {aggregation.warnings.length > 0 && (
                  <Alert className="mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Some rows were skipped</AlertTitle>
                    <AlertDescription>
                      <ul className="list-inside list-disc space-y-0.5">
                        {aggregation.warnings.slice(0, 5).map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}

        {!showProgressScreen && rawRows.length > 0 && (
          <DialogFooter>
            <Button onClick={handleImport} disabled={importing || !aggregation?.records?.length}>
              {importing ? (
                "Importing..."
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Import {aggregation?.records?.length || 0} day{aggregation?.records?.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
