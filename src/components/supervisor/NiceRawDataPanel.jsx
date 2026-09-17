import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Upload, Trash2 } from "lucide-react";
import { getReportTable, deleteReportTable } from "@/features/supervisorDashboard/importedTableStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import SpreadsheetGridTable from "@/components/supervisor/SpreadsheetGridTable";

const REPORT_TYPE = "incorta_input";
const REPORT_LABEL = "NICE Call - RAW DATA";

/**
 * Dedicated top-level tab for browsing "NICE Call - RAW DATA" (the incorta_input report
 * type) as a full spreadsheet grid - per explicit request, since this report (2,709 real
 * rows x 23 real columns confirmed this session) is too large/wide for the existing
 * compact-row Report Data view to be useful for deep, Excel-like review with sort/filter.
 *
 * This is READ-ONLY with respect to Executive Overview - it uses the exact same
 * supervisorReportTables storage and saveReportTable()/deleteReportTable() functions the
 * existing Report Data tab already uses for this same report type (incorta_input is NOT
 * read by any Executive Overview KPI tile or opsMetricsStore.js calculation), so importing
 * or clearing data here can NEVER affect any tile on Executive Overview.
 *
 * This report type remains ALSO available under Report Data's sidebar for now (per explicit
 * request to leave that as-is) - both surfaces read/write the exact same underlying stored
 * table, so an import done from either place shows up in both immediately.
 */
export default function NiceRawDataPanel() {
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

  // Same "reload on mount AND on tab re-visibility" pattern as ReportDataTablesPanel.jsx -
  // Radix Tabs keeps this component mounted rather than destroying/recreating it on every
  // tab switch, so a mount-only effect would go stale after the first load.
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
            <SpreadsheetGridTable
              table={table}
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
              Report Data's "Incorta-O&M-Input" entry, since both views share the same
              underlying stored table.
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