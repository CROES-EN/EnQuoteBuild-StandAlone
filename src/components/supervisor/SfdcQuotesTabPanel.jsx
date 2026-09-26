import {useCallback, useEffect, useState} from "react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {Trash2, Upload} from "lucide-react";
import {deleteReportTable, getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import ReportDataTable from "@/components/supervisor/ReportDataTable";

const REPORT_TYPE = "sfdc_quotes";
const REPORT_LABEL = "SFDC-Quotes";
// All 14 real confirmed columns, shown by default - per explicit request to view "everything"
// for this report, matching the existing "everything visible unless hidden" default this app
// already uses whenever no defaultHiddenColumns list is supplied (see
// tableColumnPreferences.js) - no NEW default-hiding behavior needed here.
const DEFAULT_SUMMARY_FIELDS = [
  { column: "Case Number", label: "Case Number" },
  { column: "Status", label: "Status" },
  { column: "O&M Status", label: "O&M Status" },
  { column: "Account Name", label: "Account Name" }
];

/**
 * Dedicated top-level tab for browsing SFDC-Quotes - per explicit request to make this
 * report's full data directly reachable from the main tab bar, not just Report Data's
 * sidebar. Reuses the EXACT SAME ReportDataTable.jsx component already proven for this
 * report type under Report Data - purely an additional way to VIEW/manage data that already
 * exists there (both views share the identical underlying stored table). SFDC-Quotes remains
 * ALSO available under Report Data's sidebar for now, per explicit request to leave that
 * as-is. Confirmed NOT read by any Executive Overview KPI tile or opsMetricsStore.js.
 */
export default function SfdcQuotesTabPanel() {
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadTable = useCallback(async ({ showSpinner } = {}) => {
    if (showSpinner) setReloading(true); else setLoading(true);
    try {
      const result = await getReportTable(REPORT_TYPE);
      setTable(result);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    loadTable();
    function handleVisibility() {
      if (document.visibilityState === "visible") loadTable();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [loadTable]);

  function handleImported() {
    loadTable({ showSpinner: true });
  }

  async function handleConfirmClear() {
    setClearing(true);
    try {
      await deleteReportTable(REPORT_TYPE);
      await loadTable({ showSpinner: true });
    } finally {
      setClearing(false);
      setClearConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">{REPORT_LABEL}</CardTitle>
          <div className="flex gap-2">
            {table && (
              <Button
                size="sm"
                variant="outline"
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear Data
              </Button>
            )}
            <Button size="sm" onClick={() => setImportDialogOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import This Report
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : (
            <ReportDataTable
              reportType={REPORT_TYPE}
              table={table}
              defaultSummaryFields={DEFAULT_SUMMARY_FIELDS}
              onReload={() => loadTable({ showSpinner: true })}
              isReloading={reloading}
            />
          )}
        </CardContent>
      </Card>

      <ImportAsTableDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        reportType={REPORT_TYPE}
        reportLabel={REPORT_LABEL}
        onImported={handleImported}
      />

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear "{REPORT_LABEL}" data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every row currently stored for this report, so a fresh
              import can start clean. This cannot be undone - you will need to re-import the
              report file to bring the data back. This will also clear the data shown under
              Report Data's "SFDC-Quotes" entry, since both views share the same underlying
              stored table.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClear}
              disabled={clearing}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {clearing ? "Clearing..." : "Clear Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}