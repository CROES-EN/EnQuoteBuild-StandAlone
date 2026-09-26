import {useMemo, useState} from "react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {Checkbox} from "@/components/ui/checkbox";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {AlertTriangle, FileSpreadsheet, Upload} from "lucide-react";
import {
    buildColumnOptions,
    guessHeaderRowIndex,
    isHtmlReportFile,
    peekHtmlSectionNames,
    peekReportFile,
    readHtmlSectionRows,
    readPeekedSheet,
    readPeekedSheets,
    readWorkbookFromBytes
} from "@/features/supervisorDashboard/reportParsing";
import {saveStaffingSnapshot} from "@/features/supervisorDashboard/importedTableStore";
import {saveReportTableWithRetry} from "@/features/supervisorDashboard/saveReportTableWithRetry";
import {parseOMStaffingRawRows} from "@/features/supervisorDashboard/parseOMStaffingReport";
import {validateImport} from "@/features/supervisorDashboard/importValidation";

/**
 * Imports a spreadsheet tab AS-IS into a browsable table (no daily aggregation) - for row-level
 * lists like Escalations, Audits, Care-Cases, etc. where each row is its own case/record rather
 * than something that should be summed into a single daily number. Reuses the exact same
 * file-reading and sheet-selection functions as the "Import Report" dialog (reportParsing.js),
 * so behavior (multi-sheet workbooks, header-row detection, etc.) stays consistent across both
 * import paths - it only diverges at the final step, saving raw rows instead of calling
 * aggregateRowsByDate().
 *
 * Re-import behavior: REPLACE. Saving this report type again fully replaces its previous rows
 * (see importedTableStore.js for why) - there is no merge/append here by design.
 */
export default function ImportAsTableDialog({ open, onOpenChange, reportType, reportLabel, onImported }) {
  const [fileName, setFileName] = useState("");
  const [peeked, setPeeked] = useState(null);
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [folderImporting, setFolderImporting] = useState(false);
  const [folderSkipped, setFolderSkipped] = useState([]);
  // Purely visual - true only while a file is being dragged over the drop zone, so it can
  // highlight. Never affects which file actually gets imported; the drop handler below calls
  // the exact same handleFileChosen() the "Choose File" button already uses.
  const [isDragOver, setIsDragOver] = useState(false);

  const columnOptions = useMemo(
    () => (rawRows.length ? buildColumnOptions(rawRows, headerRowIndex) : []),
    [rawRows, headerRowIndex]
  );

  const dataRows = useMemo(() => {
    if (!rawRows.length || !columnOptions.length) return [];
    const headers = columnOptions.map((c) => c.label);
    return rawRows.slice(headerRowIndex + 1).map((row) => {
      const record = {};
      headers.forEach((header, i) => {
        record[header] = row[i] ?? "";
      });
      return record;
    }).filter((record) => Object.values(record).some((v) => String(v).trim() !== ""));
  }, [rawRows, columnOptions, headerRowIndex]);

  function resetState() {
    setFileName("");
    setPeeked(null);
    setSelectedSheetNames([]);
    setRawRows([]);
    setHeaderRowIndex(0);
    setError("");
  }

  async function handleFileChosen(file) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      if (reportType === "staffing") {
        const text = await file.text();
        const rows = parseOMStaffingRawRows(text);
        if (rows.length <= 1) {
          setError("No agent rows were found in this file - make sure you exported the full Supervisor Snapshot (the \"Agent\" section with one row per agent).");
        } else {
          setFileName(file.name);
          setPeeked({ kind: "staffing", sheetNames: [] });
          setRawRows(rows);
          setHeaderRowIndex(0);
        }
        setLoading(false);
        return;
      }
      const peekedFile = await peekReportFile(file);
      setFileName(file.name);
      setPeeked(peekedFile);
      if (peekedFile.sheetNames.length <= 1) {
        const only = peekedFile.sheetNames[0];
        setSelectedSheetNames(only ? [only] : []);
        if (only) {
          const rows = readPeekedSheet(peekedFile, only);
          setRawRows(rows);
          setHeaderRowIndex(guessHeaderRowIndex(rows));
        }
      } else {
        // Auto-select sheets and continue immediately - no manual "Select the tab to
        // import" step, per explicit request. For eodb_hourly_wait_time specifically,
        // only the "Detail" sheet (name contains "deta") is usable - its Pivot sheet has a
        // completely different column shape (dates-as-columns) and merging the two
        // together was confirmed to produce garbage blank-header columns. Every other
        // report type defaults to ALL sheets, exactly as requested. Falls back to all
        // sheets if no "deta"-matching sheet name is found, so this never silently skips
        // a file that doesn't follow that naming pattern.
        const detailSheet = peekedFile.sheetNames.find((n) => /deta/i.test(n));
        const autoSelected = (reportType === "eodb_hourly_wait_time" && detailSheet)
          ? [detailSheet]
          : peekedFile.sheetNames;
        setSelectedSheetNames(autoSelected);
        try {
          if (autoSelected.length === 1) {
            const rows = readPeekedSheet(peekedFile, autoSelected[0]);
            setRawRows(rows);
            setHeaderRowIndex(guessHeaderRowIndex(rows));
          } else {
            const { rows, headerRowIndex: idx } = readPeekedSheets(peekedFile, autoSelected);
            setRawRows(rows);
            setHeaderRowIndex(idx);
          }
        } catch (err) {
          setError(err.message || "Could not read this file's tabs.");
        }
      }
    } catch (err) {
      setError(err.message || "This file could not be read.");
    }
    setLoading(false);
  }

  // Handles a MULTI-FILE drag-and-drop (2+ files dropped at once) - reuses the EXACT SAME
  // "winning layout" merge algorithm already proven in handleFolderChosen below (group files
  // by identical column layout, keep only the largest matching group, report the rest as
  // skipped), just fed from browser File objects (via the drop event) instead of Electron's
  // folder-picker bridge. This keeps drag-and-drop group behavior consistent with the
  // existing "Choose Folder" button rather than inventing a second, different merge rule.
  async function handleFilesDropped(files) {
    if (!files || !files.length) return;
    setLoading(true);
    setError("");
    setFolderSkipped([]);

    function isNonBlankRow(row) {
      return Array.isArray(row) && row.some((value) => String(value ?? "").trim() !== "");
    }

    function normalizeRows(rows) {
      if (!Array.isArray(rows) || !rows.length) return null;
      const headerIdx = guessHeaderRowIndex(rows);
      if (!Number.isInteger(headerIdx) || headerIdx < 0 || headerIdx >= rows.length) return null;

      const originalHeader = Array.isArray(rows[headerIdx]) ? rows[headerIdx] : [];
      let lastMeaningfulColumn = -1;
      originalHeader.forEach((value, index) => {
        if (String(value ?? "").trim() !== "") lastMeaningfulColumn = index;
      });
      if (lastMeaningfulColumn < 0) return null;

      const headerRow = originalHeader.slice(0, lastMeaningfulColumn + 1);
      const normalizedHeaders = headerRow.map((value) =>
        String(value ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
      );
      if (!normalizedHeaders.some(Boolean)) return null;

      const dataRows = rows
        .slice(headerIdx + 1)
        .filter(isNonBlankRow)
        .map((row) => row.slice(0, lastMeaningfulColumn + 1));

      if (!dataRows.length) return null;
      return {
        headerRow,
        headerKey: normalizedHeaders.join("|"),
        dataRows,
        columnCount: normalizedHeaders.filter(Boolean).length
      };
    }

    function chooseBestCandidate(candidates) {
      return candidates
        .filter(Boolean)
        .sort((a, b) =>
          b.dataRows.length - a.dataRows.length ||
          b.columnCount - a.columnCount ||
          String(a.sourceName).localeCompare(String(b.sourceName))
        )[0] || null;
    }

    try {
      const readFiles = [];
      for (const file of [...files].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        try {
          const peekedFile = await peekReportFile(file);
          const candidates = (peekedFile.sheetNames.length ? peekedFile.sheetNames : [null]).map((sheetName) => {
            const rows = sheetName ? readPeekedSheet(peekedFile, sheetName) : null;
            const normalized = rows ? normalizeRows(rows) : null;
            return normalized ? { ...normalized, sourceName: sheetName || file.name } : null;
          });
          const best = chooseBestCandidate(candidates);
          if (!best) {
            readFiles.push({ name: file.name, ok: false, reason: "No nonblank data rows were found." });
            continue;
          }
          readFiles.push({ name: file.name, ok: true, ...best });
        } catch (err) {
          readFiles.push({ name: file.name, ok: false, reason: err?.message || "Could not be read." });
        }
      }

      const layouts = new Map();
      for (const file of readFiles) {
        if (!file.ok) continue;
        const current = layouts.get(file.headerKey) || {
          headerKey: file.headerKey,
          totalRows: 0,
          fileCount: 0,
          columnCount: file.columnCount
        };
        current.totalRows += file.dataRows.length;
        current.fileCount += 1;
        current.columnCount = Math.max(current.columnCount, file.columnCount);
        layouts.set(file.headerKey, current);
      }

      const winningLayout = [...layouts.values()].sort((a, b) =>
        b.totalRows - a.totalRows ||
        b.fileCount - a.fileCount ||
        b.columnCount - a.columnCount ||
        a.headerKey.localeCompare(b.headerKey)
      )[0];

      if (!winningLayout) {
        const details = readFiles
          .filter((file) => !file.ok)
          .map((file) => `${file.name}: ${file.reason}`)
          .join("; ");
        throw new Error(details ? `No usable table was found. ${details}` : "No usable table was found.");
      }

      const matchingFiles = readFiles.filter(
        (file) => file.ok && file.headerKey === winningLayout.headerKey
      );
      const referenceHeaderRow = matchingFiles[0]?.headerRow;
      const combinedRows = matchingFiles.flatMap((file) => file.dataRows);
      const skipped = readFiles
        .filter((file) => !file.ok || file.headerKey !== winningLayout.headerKey)
        .map((file) => ({
          name: file.name,
          reason: file.ok
            ? `Different column layout (${file.columnCount} columns, ${file.dataRows.length} rows).`
            : file.reason
        }));

      if (!referenceHeaderRow || !combinedRows.length) {
        throw new Error("None of the dropped files could be combined into a usable table.");
      }

      // Include an ACTUAL matched filename (not just a generic "N file(s)" summary) - the
      // import validation gate recognizes known report types (e.g. EODB Dashboard call-metric
      // exports, which never have a "Case Number" column) by checking whether this fileName
      // CONTAINS a known pattern, so a made-up summary string would silently defeat that
      // check for every multi-file merge. Confirmed via direct testing before this fix.
      setFileName(
        matchingFiles.length === 1
          ? matchingFiles[0].name
          : `${matchingFiles.length} files (e.g. ${matchingFiles[0].name})`
      );
      setPeeked({ kind: "folder", sheetNames: [] });
      setSelectedSheetNames([]);
      setRawRows([referenceHeaderRow, ...combinedRows]);
      setHeaderRowIndex(0);
      setFolderSkipped(skipped);
    } catch (err) {
      setError(err?.message || "Could not import these files.");
    }
    setLoading(false);
  }

  async function handleFolderChosen() {
    const bridge = globalThis.window?.enquoteLocal?.dialogs;
    if (!bridge?.selectFolder || !bridge?.readFolderFiles) {
      setError("Folder import is only available in the EnQuote desktop app.");
      return;
    }

    setFolderImporting(true);
    setError("");
    setFolderSkipped([]);

    try {
      const picked = await bridge.selectFolder();
      if (!picked?.ok) {
        throw new Error(picked?.error || "Could not open the folder picker.");
      }
      if (picked.canceled || !picked.path) return;

      const readResult = await bridge.readFolderFiles(picked.path);
      if (!readResult?.ok) {
        throw new Error(readResult?.error || "Could not read that folder.");
      }
      if (!Array.isArray(readResult.files) || !readResult.files.length) {
        throw new Error("That folder has no importable files (.xlsx, .xls, .csv, .html, or .htm).");
      }

      function base64ToBytes(base64) {
        if (typeof base64 !== "string" || !base64.length) {
          throw new Error("The file contained no readable data.");
        }
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        return bytes;
      }

      function isNonBlankRow(row) {
        return Array.isArray(row) && row.some((value) => String(value ?? "").trim() !== "");
      }

      function normalizeRows(rows) {
        if (!Array.isArray(rows) || !rows.length) return null;
        const headerIdx = guessHeaderRowIndex(rows);
        if (!Number.isInteger(headerIdx) || headerIdx < 0 || headerIdx >= rows.length) return null;

        const originalHeader = Array.isArray(rows[headerIdx]) ? rows[headerIdx] : [];
        let lastMeaningfulColumn = -1;
        originalHeader.forEach((value, index) => {
          if (String(value ?? "").trim() !== "") lastMeaningfulColumn = index;
        });
        if (lastMeaningfulColumn < 0) return null;

        const headerRow = originalHeader.slice(0, lastMeaningfulColumn + 1);
        const normalizedHeaders = headerRow.map((value) =>
          String(value ?? "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
        );
        if (!normalizedHeaders.some(Boolean)) return null;

        const dataRows = rows
          .slice(headerIdx + 1)
          .filter(isNonBlankRow)
          .map((row) => row.slice(0, lastMeaningfulColumn + 1));

        if (!dataRows.length) return null;
        return {
          headerRow,
          headerKey: normalizedHeaders.join("|"),
          dataRows,
          columnCount: normalizedHeaders.filter(Boolean).length
        };
      }

      function chooseBestCandidate(candidates) {
        return candidates
          .filter(Boolean)
          .sort((a, b) =>
            b.dataRows.length - a.dataRows.length ||
            b.columnCount - a.columnCount ||
            String(a.sourceName).localeCompare(String(b.sourceName))
          )[0] || null;
      }

      // ROBUST FOLDER IMPORT: deterministic layout selection.
      // Every HTML section and every workbook sheet is evaluated. Fully blank trailing rows
      // are removed before scoring so worksheet formatting cannot win the layout selection.
      const readFiles = [];
      for (const file of [...readResult.files].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        try {
          const bytes = base64ToBytes(file.base64);
          const candidates = [];

          if (isHtmlReportFile(file.name)) {
            const text = new TextDecoder("utf-8").decode(bytes);
            for (const sectionName of peekHtmlSectionNames(text)) {
              const normalized = normalizeRows(readHtmlSectionRows(text, sectionName));
              if (normalized) candidates.push({ ...normalized, sourceName: sectionName });
            }
          } else {
            const workbook = readWorkbookFromBytes(bytes);
            for (const sheetName of workbook.sheetNames || []) {
              const normalized = normalizeRows(workbook.getSheetRows(sheetName));
              if (normalized) candidates.push({ ...normalized, sourceName: sheetName });
            }
          }

          const best = chooseBestCandidate(candidates);
          if (!best) {
            readFiles.push({ name: file.name, ok: false, reason: "No nonblank data rows were found." });
            continue;
          }
          readFiles.push({ name: file.name, ok: true, ...best });
        } catch (err) {
          readFiles.push({ name: file.name, ok: false, reason: err?.message || "Could not be read." });
        }
      }

      // Score layouts by usable rows first, then supporting file count, meaningful columns,
      // and finally the normalized header key. This makes ties stable across operating systems.
      const layouts = new Map();
      for (const file of readFiles) {
        if (!file.ok) continue;
        const current = layouts.get(file.headerKey) || {
          headerKey: file.headerKey,
          totalRows: 0,
          fileCount: 0,
          columnCount: file.columnCount
        };
        current.totalRows += file.dataRows.length;
        current.fileCount += 1;
        current.columnCount = Math.max(current.columnCount, file.columnCount);
        layouts.set(file.headerKey, current);
      }

      const winningLayout = [...layouts.values()].sort((a, b) =>
        b.totalRows - a.totalRows ||
        b.fileCount - a.fileCount ||
        b.columnCount - a.columnCount ||
        a.headerKey.localeCompare(b.headerKey)
      )[0];

      if (!winningLayout) {
        const details = readFiles
          .filter((file) => !file.ok)
          .map((file) => `${file.name}: ${file.reason}`)
          .join("; ");
        throw new Error(details ? `No usable table was found. ${details}` : "No usable table was found.");
      }

      const matchingFiles = readFiles.filter(
        (file) => file.ok && file.headerKey === winningLayout.headerKey
      );
      const referenceHeaderRow = matchingFiles[0]?.headerRow;
      const combinedRows = matchingFiles.flatMap((file) => file.dataRows);
      const skipped = readFiles
        .filter((file) => !file.ok || file.headerKey !== winningLayout.headerKey)
        .map((file) => ({
          name: file.name,
          reason: file.ok
            ? `Different column layout (${file.columnCount} columns, ${file.dataRows.length} rows; source: ${file.sourceName}).`
            : file.reason
        }));

      if (!referenceHeaderRow || !combinedRows.length) {
        throw new Error("None of the files in that folder could be combined into a usable table.");
      }

      setFileName(`${matchingFiles.length} file(s) from ${picked.path}`);
      setPeeked({ kind: "folder", sheetNames: [] });
      setSelectedSheetNames([]);
      setRawRows([referenceHeaderRow, ...combinedRows]);
      setHeaderRowIndex(0);
      setFolderSkipped(skipped);
    } catch (err) {
      setError(err?.message || "Could not import that folder.");
    } finally {
      setFolderImporting(false);
    }
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
        setRawRows(rows);
        setHeaderRowIndex(guessHeaderRowIndex(rows));
      } else {
        const { rows, headerRowIndex: idx } = readPeekedSheets(peeked, selectedSheetNames);
        setRawRows(rows);
        setHeaderRowIndex(idx);
      }
    } catch (err) {
      setError(err.message || "Could not read the selected tab(s).");
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!dataRows.length) return;

    // Import validation gate: checks the parsed columns/rows BEFORE anything is ever handed
    // to saveReportTable()/saveStaffingSnapshot() - i.e. before it can reach disk at all. Runs
    // for every report type, using the same columnOptions/dataRows already computed above.
    // Catches the most common real import mistakes (wrong sheet selected, wrong file
    // entirely, duplicate column names) with a clear, specific message immediately, instead
    // of silently storing bad data that only gets noticed later via a wrong tile number. The
    // full message is shown via toast (guaranteed visible regardless of which panel of this
    // dialog is currently showing), and also set on `error` as a second, redundant display.
    const validation = validateImport(reportType, columnOptions, dataRows, fileName);
    if (!validation.valid) {
      const message = validation.errors.join(" ");
      setError(message);
      toast.error(message);
      return;
    }

    if (reportType === "staffing") {
      setSaving(true);
      try {
        await saveStaffingSnapshot({
          columns: columnOptions.map((c) => c.label),
          rows: dataRows,
          sourceFileName: fileName,
          importedAt: new Date().toISOString()
        });
        const importedDates = Array.from(new Set(dataRows.map((row) => row.Date))).sort();
        const dateRangeLabel = importedDates.length > 1
          ? `${importedDates[0]} through ${importedDates[importedDates.length - 1]}`
          : (importedDates[0] || "");
        toast.success(`Imported ${dataRows.length} agent row${dataRows.length === 1 ? "" : "s"} into Staffing (${dateRangeLabel}).`);
        onImported?.();
        onOpenChange(false);
        resetState();
      } catch (err) {
        toast.error(err.message || "Import failed.");
      }
      setSaving(false);
      return;
    }
    setSaving(true);
    try {
      await saveReportTableWithRetry(reportType, {
        columns: columnOptions.map((c) => c.label),
        rows: dataRows,
        sourceFileName: fileName,
        importedAt: new Date().toISOString(),
        importMethod: "manual"
      });
      toast.success(`Imported ${dataRows.length} row${dataRows.length === 1 ? "" : "s"} into ${reportLabel}.`);
      onImported?.();
      onOpenChange(false);
      resetState();
    } catch (err) {
      toast.error(err.message || "Import failed.");
    }
    setSaving(false);
  }

  const showSheetPicker = Boolean(peeked && !rawRows.length && peeked.sheetNames.length > 1);

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) resetState(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
            Import {reportLabel}
          </DialogTitle>
          <DialogDescription>
            {reportType === "staffing"
              ? "This imports your OM Staffing Report export (per-agent Login Time, Handle Time, etc.) for any date range - re-importing replaces only the dates included in the new file, keeping every other date's history intact."
              : "This loads every row as-is for browsing - it does not affect daily metrics on the Executive Overview. Re-importing replaces the current table with the new file's rows."}


          </DialogDescription>
        </DialogHeader>

        {!peeked && (
          <div className="space-y-3 py-4">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.html,.htm"
              className="hidden"
              id="table-import-file-input"
              onChange={(e) => e.target.files?.[0] && handleFileChosen(e.target.files[0])}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); if (!loading && !folderImporting) setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (loading || folderImporting) return;
                const droppedFiles = e.dataTransfer?.files;
                if (!droppedFiles || !droppedFiles.length) return;
                // 2+ files dropped together -> merge-by-layout (same algorithm as "Choose
                // Folder"). Exactly 1 file -> the existing single-file path, unchanged.
                if (droppedFiles.length > 1) {
                  handleFilesDropped([...droppedFiles]);
                } else {
                  handleFileChosen(droppedFiles[0]);
                }
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                isDragOver ? "border-indigo-500 bg-indigo-50" : "border-border bg-secondary/40"
              }`}
            >
              <Upload className={`h-6 w-6 ${isDragOver ? "text-indigo-600" : "text-muted-foreground"}`} />
              <p className="text-sm text-muted-foreground">
                {isDragOver ? "Drop the file(s) to import" : "Drag and drop a file (or multiple files) here, or"}
              </p>
              <Button className="w-full" disabled={loading || folderImporting} onClick={() => { const input = document.getElementById("table-import-file-input"); if (input) input.value = ""; input?.click(); }}>
                <Upload className="mr-2 h-4 w-4" />
                {loading ? "Reading file..." : "Choose File"}
              </Button>
            </div>
            {reportType !== "staffing" && (
            <Button className="w-full" variant="outline" disabled={loading || folderImporting} onClick={handleFolderChosen}>
              <Upload className="mr-2 h-4 w-4" />
              {folderImporting ? "Reading folder..." : "Choose Folder"}
            </Button>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Couldn't read file</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {showSheetPicker && (
          <div className="space-y-3 py-4">
            <p className="text-sm font-semibold text-foreground">Select the tab to import</p>
            <div className="max-h-64 divide-y overflow-auto rounded-lg border">
              {peeked.sheetNames.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-secondary">
                  <Checkbox checked={selectedSheetNames.includes(name)} onCheckedChange={(c) => toggleSheet(name, c === true)} />
                  {name}
                </label>
              ))}
            </div>
            <Button onClick={handleContinueWithSheets} disabled={loading || !selectedSheetNames.length}>
              {loading ? "Reading..." : "Continue"}
            </Button>
          </div>
        )}


          {rawRows.length > 0 && !showSheetPicker && (
          <div className="space-y-2 py-2">
            
            {folderSkipped.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
                <p className="text-xs font-medium text-amber-800">Skipped {folderSkipped.length} file(s) (different layout, not merged):</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                  {folderSkipped.map((s) => (<li key={s.name}>{s.name} - {s.reason}</li>))}
                </ul>
              </div>
            )}
          </div>
        )}

        {rawRows.length > 0 && (
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            {error && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Import blocked</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex shrink-0 justify-end gap-2">
              {error && (
                <Button variant="outline" onClick={resetState}>
                  Retry
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving || !dataRows.length}>
                {saving ? "Saving..." : `Import ${dataRows.length} row${dataRows.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
