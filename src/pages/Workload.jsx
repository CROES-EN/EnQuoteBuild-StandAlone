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
import RoleGuard from "@/components/auth/RoleGuard";
import {deleteReportTable, getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import WorkloadReportTable from "@/components/supervisor/WorkloadReportTable";
import SalesforceImportButton from "@/components/supervisor/SalesforceImportButton";

const REPORT_TYPE = "workload";
const REPORT_LABEL = "Workload";

/**
 * Personal open-case workload tracker - mirrors the user's own Excel "O&M Case Tracker"
 * (Open/O&M Status/Project Picklist/Case Number/Case Owner/Subject/etc., 17 real columns from
 * a Salesforce export already filtered to the signed-in user's own cases). Reuses the exact
 * same manual import mechanism as the Supervisor Dashboard's report tabs (ImportAsTableDialog +
 * importedTableStore, stored under its own "workload" report type key so it never collides
 * with Escalations/SFDC-Quotes/etc.), but lives as its own top-level sidebar page rather than a
 * Supervisor Dashboard tab, since this is a personal daily-use view, not a supervisor tool.
 *
 * The imported file's own "Open" column is a frozen Excel-formula result (accurate only at the
 * moment of export) and is intentionally NEVER displayed - WorkloadReportTable.jsx recomputes
 * it live from "Case Date/Time Last Modified" every render, exactly matching the user's own
 * formula: =IF([@[Case Date/Time Last Modified]]="","",TODAY()-INT([@[Case Date/Time Last
 * Modified]])). "Age (Days)" (case creation age, from Salesforce) is left as-is, unmodified,
 * per explicit request - no client-side calculation needed there.
 *
 * FIX (sturdiness/no-flicker): the visibility/focus handler below previously called
 * loadTable() with NO arguments, which - because loadTable's `showSpinner` parameter defaults
 * to falsy - took the `setLoading(true)` branch instead of `setReloading(true)`. Since this
 * page unmounts WorkloadReportTable entirely while `loading` is true (see the
 * loading ? <p>Loading...</p> : <WorkloadReportTable .../> below), every single window
 * refocus/alt-tab was destroying and recreating WorkloadReportTable from scratch - wiping out
 * every bit of local state it owns (search text, sort column/direction, active tile filter,
 * "Review Me" toggle, column drag-reorder position) even though the underlying data on disk
 * had almost certainly not changed at all. This is the confirmed root cause of the reported
 * "flicker on refocus, loses my filters/sorting" behavior. The fix: explicitly pass
 * `{ showSpinner: true }` here, exactly like handleImported/handleConfirmClear already do -
 * this takes the `setReloading(true)` branch instead, which does NOT unmount
 * WorkloadReportTable (only its own internal "Reloading..." button label changes), so a
 * refocus now quietly refreshes data in the background with zero visible flicker and zero
 * loss of the user's current filters/sort/column order.
 */
function WorkloadContent() {
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
    // Initial mount load only - this is the ONE legitimate place a full "loading" state (and
    // therefore the unmounted <p>Loading...</p> placeholder) makes sense, since there is no
    // existing WorkloadReportTable instance yet to preserve state in.
    loadTable();

    // FIX: pass { showSpinner: true } so a window refocus/visibility change reloads data via
    // the non-destructive `reloading` path instead of the `loading` path - see the function-
    // level comment above for the full explanation. WorkloadReportTable stays mounted the
    // entire time, so all of its local filter/sort/column-order state survives untouched.
    function handleVisibility() {
      if (document.visibilityState === "visible") loadTable({ showSpinner: true });
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
    <div className="p-6 max-w-[112rem] mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Workload</h1>
          <p className="text-muted-foreground mt-1">
            Your open Salesforce cases, mirroring your personal case tracker - re-import your
            export any time to refresh. "Open" is always calculated live from each case's last
            modified date, so it's never a stale, frozen number.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Open Cases</CardTitle>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
            {table && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Clear Data
                </Button>
                <div className="h-5 w-px bg-border" />
              </>
            )}
            <SalesforceImportButton
              reportType={REPORT_TYPE}
              reportLabel={REPORT_LABEL}
              onImported={handleImported}
            />
            <Button size="sm" onClick={() => setImportDialogOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import Report
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : (
            <WorkloadReportTable
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
              This permanently deletes every case currently stored here, so a fresh import can
              start clean. This cannot be undone - you will need to re-import your report file
              to bring the data back.
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

export default function Workload() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <WorkloadContent />
    </RoleGuard>
  );
}
