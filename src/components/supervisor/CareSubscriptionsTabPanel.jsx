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
import CareDataHygieneReport from "@/components/supervisor/CareDataHygieneReport";

const REPORT_TYPE = "care_subscriptions";
const REPORT_LABEL = "Care Subscriptions";
const DEFAULT_SUMMARY_FIELDS = [
  { column: "Enlighten Site Id", label: "Site ID" },
  { column: "Customer First Name", label: "First Name" },
  { column: "Customer Last Name", label: "Last Name" },
  { column: "Subscription Status", label: "Status" }
];
// SAME 23-column default-hidden list as Stage 1's Report Data entry, kept in sync
// deliberately - only these 8 columns show until a user turns more on via "Columns":
// Subscription Id, Customer First Name, Customer Last Name, Customer Address,
// Subscription Status, Plan Amount, Enlighten Site Id, Estore Sku.
const DEFAULT_HIDDEN_COLUMNS = [
  "Customer Phone", "Customer Email", "Plan Name", "Plan Description", "Created Dt",
  "Paid Dt", "Agreement Dt", "Agreement Week", "Activation Dt", "Activation Week",
  "Renewal Date", "Cancelled At", "Expired At", "Inbound Channel", "Referrer", "Source",
  "Rep", "Envelope Id", "Stripe Subscription Id", "Stripe Payment Link Id",
  "Stripe Payment Link Url", "Subscription Year", "Documents"
];

/**
 * Dedicated top-level tab for browsing Care Subscriptions - per explicit request to make this
 * report's full data directly reachable from the main tab bar, not just Report Data's
 * sidebar. Reuses the EXACT SAME ReportDataTable.jsx component AND the same
 * defaultHiddenColumns list built in Stage 1 for Report Data's own Care Subscriptions entry
 * - both views share the identical underlying stored table AND the identical column-
 * visibility preferences (tableColumnPreferences.js is keyed by reportType, not by which tab
 * is showing it), so a column shown/hidden from either place stays consistent everywhere.
 * Also renders the same Care Data Hygiene report shown under Report Data, for the same
 * reason it exists there: confirming Enphase Care eligibility (does a homeowner currently
 * have active Care, so travel/labor can be waived on an FST visit) is O&M-focused, not a
 * sales concern, and needs internal/test records excluded and duplicate Site IDs treated as
 * renewal history rather than data conflicts.
 *
 * Care Subscriptions remains ALSO available under Report Data's sidebar for now, per
 * explicit request to leave that as-is. Confirmed NOT read by any Executive Overview KPI
 * tile or opsMetricsStore.js calculation.
 */
export default function CareSubscriptionsTabPanel() {
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
      {!loading && table && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Care Data Hygiene</CardTitle>
            <p className="text-xs text-muted-foreground">
              Used to confirm Enphase Care eligibility for waiving travel and labor on FST
              visits. Not a sales report - internal/test records are excluded, and duplicate
              Site IDs are treated as renewal history, not conflicts.
            </p>
          </CardHeader>
          <CardContent>
            <CareDataHygieneReport table={table} />
          </CardContent>
        </Card>
      )}

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
              defaultHiddenColumns={DEFAULT_HIDDEN_COLUMNS}
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
              Report Data's "Care Subscriptions" entry, since both views share the same
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