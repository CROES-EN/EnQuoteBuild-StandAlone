import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil } from "lucide-react";
import { getSalesforceReportUrl, setSalesforceReportUrl } from "@/features/supervisorDashboard/workloadSalesforceSettings";
import { readWorkbookFromBytes, guessHeaderRowIndex, buildColumnOptions } from "@/features/supervisorDashboard/reportParsing";
import { saveReportTableWithRetry } from "@/features/supervisorDashboard/saveReportTableWithRetry";
import { validateImport } from "@/features/supervisorDashboard/importValidation";

/**
 * Simple, theme-neutral Salesforce "cloud" mark (not the real trademarked logo asset, which
 * isn't available to bundle here) - close enough visually to be instantly recognizable as
 * "this button does something with Salesforce" at a glance, in Salesforce's own brand blue.
 */
function SalesforceCloudIcon({ className }) {
  return (
    <svg viewBox="0 0 32 20" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M13.2 3.6c1.1-1.2 2.7-1.9 4.4-1.9 2.3 0 4.3 1.3 5.4 3.2.9-.4 1.9-.6 3-.6 4 0 7.2 3.3 7.2 7.3 0 4-3.2 7.3-7.2 7.3-.5 0-1-.1-1.4-.1-.9 1.6-2.6 2.7-4.6 2.7-.8 0-1.6-.2-2.3-.5-1 2.3-3.3 3.9-5.9 3.9-2.7 0-5.1-1.7-6-4.2-.4.1-.9.1-1.3.1-3.6 0-6.5-2.9-6.5-6.6 0-2.4 1.3-4.6 3.2-5.7-.4-.9-.6-1.9-.6-2.9C.6 2.5 3.6-.6 7.3-.6c2.2 0 4.1 1 5.4 2.7.2.5.4 1 .5 1.5z"
        fill="#00A1E0"
        transform="translate(0 2)"
      />
    </svg>
  );
}

function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

/**
 * "Import via Salesforce" button - opens a real, separate Salesforce login/report window (see
 * electron/salesforceImport.cjs) where the user logs in (2FA included) and clicks through the
 * SAME Export -> Details Only -> CSV -> Export flow they already do manually. The resulting
 * download is captured automatically and run through the exact same import pipeline/validation
 * as the existing manual "Import Report" button (ImportAsTableDialog.jsx) - this button is
 * purely an alternate ENTRY POINT into that same pipeline, not a separate/different importer.
 *
 * The report URL is saved once (first use) and reused afterward - "Change Report URL" lets the
 * user update it later if their report link ever changes.
 */
export default function SalesforceImportButton({ reportType, reportLabel, onImported }) {
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [importing, setImporting] = useState(false);

  const bridge = globalThis.window?.enquoteLocal?.salesforce;
  const isAvailable = Boolean(bridge?.openReport);

  useEffect(() => {
    if (!bridge?.onFileDownloaded) return undefined;
    const unsubscribe = bridge.onFileDownloaded(async ({ name, base64 }) => {
      setImporting(true);
      try {
        const bytes = base64ToBytes(base64);
        const workbook = readWorkbookFromBytes(bytes);
        const sheetNames = workbook.sheetNames || [];
        if (!sheetNames.length) throw new Error("No readable data was found in the downloaded file.");
        const rows = workbook.getSheetRows(sheetNames[0]);
        const headerRowIndex = guessHeaderRowIndex(rows);
        const columnOptions = buildColumnOptions(rows, headerRowIndex);
        const headers = columnOptions.map((c) => c.label);
        const dataRows = rows.slice(headerRowIndex + 1).map((row) => {
          const record = {};
          headers.forEach((header, i) => { record[header] = row[i] ?? ""; });
          return record;
        }).filter((record) => Object.values(record).some((v) => String(v).trim() !== ""));

        const validation = validateImport(reportType, columnOptions, dataRows, name);
        if (!validation.valid) {
          toast.error(validation.errors.join(" "));
          return;
        }

        await saveReportTableWithRetry(reportType, {
          columns: headers,
          rows: dataRows,
          sourceFileName: name,
          importedAt: new Date().toISOString(),
          importMethod: "salesforce"
        });
        toast.success(`Imported ${dataRows.length} row${dataRows.length === 1 ? "" : "s"} into ${reportLabel} from Salesforce.`);
        onImported?.();
        // Per explicit request: auto-close the Salesforce window, but ONLY once the import has
        // genuinely succeeded (parsed, validated, AND saved) - deliberately NOT closed on a
        // validation failure (see the early `return` above) or a thrown error (see `catch`
        // below), so the user can still see what went wrong and retry without the window
        // vanishing on them mid-troubleshoot. A short delay lets the success toast actually
        // register on-screen before the window disappears, rather than an instant, jarring cut.
        setTimeout(() => { bridge?.close?.(); }, 800);
      } catch (error) {
        toast.error(error?.message || "Could not import the downloaded Salesforce report.");
      } finally {
        setImporting(false);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, reportLabel]);

  function handleClick() {
    const savedUrl = getSalesforceReportUrl();
    if (!savedUrl) {
      setUrlDraft("");
      setUrlDialogOpen(true);
      return;
    }
    bridge.openReport(savedUrl);
  }

  function handleSaveUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    setSalesforceReportUrl(trimmed);
    setUrlDialogOpen(false);
    bridge.openReport(trimmed);
  }

  function handleChangeUrl() {
    setUrlDraft(getSalesforceReportUrl());
    setUrlDialogOpen(true);
  }

  if (!isAvailable) return null; // Electron-only feature - hidden entirely in a plain browser preview.

  return (
    <>
      {/* Redesigned for a cleaner look, per explicit request: "Import via Salesforce" shortened
          to "Salesforce" (the cloud icon already signals what it does, avoiding a wordy
          button), and "Change URL" is now a small icon-only pencil button directly attached
          to it, rather than a second separate text button competing for space. */}
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={importing}
          title={importing ? undefined : "Import via Salesforce"}
          className="gap-1.5 rounded-r-none border-r-0"
        >
          <SalesforceCloudIcon className="h-4 w-4" />
          {importing ? "Importing..." : "Salesforce"}
        </Button>
        {getSalesforceReportUrl() && (
          <Button
            size="icon"
            variant="outline"
            onClick={handleChangeUrl}
            title="Change saved Salesforce report URL"
            className="h-8 w-8 rounded-l-none text-muted-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={urlDialogOpen} onOpenChange={setUrlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SalesforceCloudIcon className="h-5 w-5" />
              Salesforce Report URL
            </DialogTitle>
            <DialogDescription>
              Paste the URL of your own Salesforce report (copy it directly from your browser's
              address bar while viewing the report). This opens in a separate window where you
              log in (and complete 2FA if prompted) exactly as you do today - EnQuote just
              watches for the CSV you export and imports it automatically. Your Salesforce
              session is remembered across app restarts, so you shouldn't need to log in every
              single time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="salesforce-report-url">Report URL</Label>
            <Input
              id="salesforce-report-url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://enphase.lightning.force.com/reports/..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveUrl} disabled={!urlDraft.trim()}>Save &amp; Open</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
