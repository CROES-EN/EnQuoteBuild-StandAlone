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
import {Table2, Trash2, Upload} from "lucide-react";
import {deleteReportTable, listReportTables} from "@/features/supervisorDashboard/importedTableStore";
import ImportAsTableDialog from "@/components/supervisor/ImportAsTableDialog";
import ReportDataTable from "@/components/supervisor/ReportDataTable";
import CareDataHygieneReport from "@/components/supervisor/CareDataHygieneReport";

/**
 * Standalone "Report Data Tables" tab - lets the user import spreadsheet tabs AS-IS (no daily
 * aggregation) and browse them as compact, labeled, click-to-expand rows inside EnQuote, with
 * per-report column visibility AND per-report summary-field configuration (which columns show
 * on the compact row, and what label each displays - e.g. showing "Contact Name" as
 * "Homeowner"). Fully separate from the Executive Overview / daily-metrics pipeline; importing
 * here never touches opsMetricsStore.js or any KPI calculation.
 *
 * The first six report types below match the O&M-Case-Tracker-v2.xlsx tabs. The seventh,
 * care_subscriptions, is a separate standalone .csv export (Enphase Care Subscription
 * Dashboard) rather than a tab in that workbook - its column names were confirmed directly
 * from the real source file, including the exact "Enlighten Site Id" capitalization (lowercase
 * "d"), which differs from the "Enlighten Site ID" capitalization used elsewhere in this
 * feature and must be matched exactly since import mapping is case-sensitive.
 *
 * care_subscriptions ALSO renders a Data Hygiene report above its table (see
 * CareDataHygieneReport.jsx) - this is O&M-focused eligibility data (does a homeowner currently
 * have active Care, so travel/labor can be waived on an FST visit), not a sales dashboard, and
 * the hygiene view exists specifically to make that eligibility answer trustworthy: excluding
 * internal/test records, surfacing records missing a Site ID, and treating duplicate Site IDs
 * as legitimate renewal history rather than as data conflicts to silently resolve.
 *
 * Each entry's `defaultSummaryFields` is only the STARTING configuration for that report type -
 * users can fully customize which columns show and what they're labeled via "Configure Fields"
 * on the Report Data tab itself, which then persists per report type going forward (see
 * summaryFieldPreferences.js) and overrides these defaults.
 */
const REPORT_TYPES = [
  {
    key: "escalations", label: "Escalations",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "Severity", label: "Severity" }
    ]
  },
  {
    key: "audits", label: "Audits",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "Status", label: "Status" }
    ]
  },
  {
    key: "care_cases", label: "Care-Cases",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "O&M Status", label: "O&M Status" }
    ]
  },
  {
    key: "om_cs_cases", label: "O&M-CS-Cases",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "O&M Status", label: "O&M Status" }
    ]
  },
  {
    key: "incorta_input", label: "Incorta-O&M-Input",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "O&M Status", label: "O&M Status" }
    ]
  },
  {
    key: "sfdc_quotes", label: "SFDC-Quotes",
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Contact Name", label: "Homeowner" },
      { column: "Case Owner", label: "Case Owner" },
      { column: "O&M Status", label: "O&M Status" }
    ]
  },
  {
    key: "care_subscriptions", label: "Care Subscriptions",
    // Per explicit request: only these 8 columns show by default (out of 31 real columns) -
    // a user can still turn any of the others on via "Columns", which persists per-browser
    // exactly like any other column visibility choice.
    defaultHiddenColumns: [
      "Customer Phone", "Customer Email", "Plan Name", "Plan Description", "Created Dt",
      "Paid Dt", "Agreement Dt", "Agreement Week", "Activation Dt", "Activation Week",
      "Renewal Date", "Cancelled At", "Expired At", "Inbound Channel", "Referrer", "Source",
      "Rep", "Envelope Id", "Stripe Subscription Id", "Stripe Payment Link Id",
      "Stripe Payment Link Url", "Subscription Year", "Documents"
    ],
    defaultSummaryFields: [
      { column: "Enlighten Site Id", label: "Site ID" },
      { column: "Customer First Name", label: "First Name" },
      { column: "Customer Last Name", label: "Last Name" },
      { column: "Subscription Status", label: "Status" }
    ]
  },
  {
    key: "staffing", label: "Staffing",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Agent Name", label: "Agent" },
      { column: "Login Time", label: "Login Time" },
      { column: "Occupancy", label: "Occupancy" }
    ]
  },
  {
    key: "email_cases", label: "Incorta - O&M Email Report",
    secondaryImport: { key: "email_daily", label: "Import Volume & AHT", buttonLabel: "Import Volume & AHT" },
    defaultSummaryFields: [
      { column: "Case Number", label: "Case Number" },
      { column: "Full Name", label: "Owner" },
      { column: "Subject", label: "Subject" },
      { column: "Status", label: "Status" }
    ]
  },
  // The 5 entries below all share the EXACT SAME pivoted "dates as columns, Grand Total as
  // last row" layout (confirmed against real EODB Dashboard exports this session) - each one
  // is its own separate storage slot feeding one specific Executive Overview tile (Total
  // Interactions, Abandoned, Abandonment Rate, Wait Time Summary, Avg Talk Time
  // respectively). Handled is computed as Total Interactions minus Abandoned, so it has no
  // separate import entry of its own. defaultSummaryFields shows "Date"/"Grand Total" as a
  // reasonable generic default for this shape - Configure Fields can still be used to adjust.
  {
    key: "eodb_total_call_volume", label: "Total Call Volume (Handled + Abandoned)",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Skillname", label: "Skillname" }
    ]
  },
  {
    key: "eodb_abandoned_calls", label: "# Abandoned Calls",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Skillname", label: "Skillname" }
    ]
  },
  {
    key: "eodb_abandonment_rate", label: "Abandonment Rate",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Skillname", label: "Skillname" }
    ]
  },
  {
    key: "eodb_daily_wait_time", label: "Daily Wait Time Summary",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Skillname", label: "Skillname" }
    ]
  },
  {
    key: "eodb_avg_talk_time", label: "Average Talk Time(Phone)",
    defaultSummaryFields: [
      { column: "Date", label: "Date" },
      { column: "Skillname", label: "Skillname" }
    ]
  },
  // Distinct from the 5 entries above: this is a SEPARATE EODB widget, broken down hourly,
  // with its own row-level layout (PST Hours, PST Date, Wait Time, # Calls, # ABN Calls,
  // Avg. Talktime, ABN %, #Unique Agents per row) rather than the "dates as columns, Grand
  // Total row" pivot layout the other 5 share - so it has NO defaultSummaryFields entry
  // (that concept doesn't apply here), and feeds HourlyWaitTimeChart.jsx directly, not the
  // pivoted Date/Skillname tile pattern the others use. When importing manually, select the
  // file's SECOND sheet (Detail) - the first sheet (Pivot) is a presentation-only cross-tab.
  {
    key: "eodb_hourly_wait_time", label: "Hourly Wait Time Summary"
  },

];

/**
 * FIX (sturdiness/no-flicker): the visibility/focus handler below previously called
 * loadTables() with NO arguments, which - because loadTables' `showSpinner` parameter
 * defaults to falsy - took the `setLoading(true)` branch instead of `setReloading(true)`.
 * Since this panel unmounts ReportDataTable (and CareDataHygieneReport, for the Care
 * Subscriptions tab) entirely while `loading` is true (see the loading ? <p>Loading...</p> :
 * <ReportDataTable .../> below), every window refocus/alt-tab was destroying and recreating
 * those components from scratch - wiping out any local search/sort/filter/column-visibility
 * state they own even though the underlying data on disk had almost certainly not changed at
 * all. This is the same confirmed root cause as the Workload tab's reported "flicker on
 * refocus, loses my filters" behavior. The fix: explicitly pass `{ showSpinner: true }` here,
 * exactly like handleImported/handleManualReload/handleConfirmClear already do - this takes
 * the `setReloading(true)` branch instead, which does NOT unmount ReportDataTable, so a
 * refocus now quietly refreshes data in the background with zero visible flicker and zero
 * loss of the user's current filters/sort/column configuration.
 */
export default function ReportDataTablesPanel() {
  const [selectedType, setSelectedType] = useState(REPORT_TYPES[0].key);
  const [tables, setTables] = useState({});
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // Tracks the OPTIONAL secondary import action some report types expose (currently only
  // "Incorta - O&M Email Report", which needs a second, structurally different source file -
  // the Daily Email Volume & AHT export - imported under its own storage key, email_daily, so
  // it never overwrites the primary Email Raw Data (email_cases) table. Both files come from
  // the SAME Incorta report, just different widgets, so they're presented as one unified
  // sidebar entry with two import actions rather than two separate, confusing entries.
  const [secondaryImportDialogOpen, setSecondaryImportDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  // Tracks which report is pending a "Clear Data" confirmation - { key, label } while the
  // AlertDialog is open, null otherwise. Set by clicking "Clear Data" on either the primary
  // report or its optional secondaryImport (e.g. "Incorta - O&M Email Report"'s Volume & AHT
  // data), so ONE shared confirmation dialog/handler covers both cases rather than
  // duplicating this flow twice.
  const [clearConfirmTarget, setClearConfirmTarget] = useState(null);
  const [clearing, setClearing] = useState(false);

  async function handleConfirmClear() {
    if (!clearConfirmTarget) return;
    setClearing(true);
    try {
      await deleteReportTable(clearConfirmTarget.key);
      await loadTables({ showSpinner: true });
    } finally {
      setClearing(false);
      setClearConfirmTarget(null);
    }
  }

  const loadTables = useCallback(async ({ showSpinner } = {}) => {
    if (showSpinner) setReloading(true); else setLoading(true);
    try {
      const all = await listReportTables();
      setTables(all);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  // Load on mount, AND every time this tab becomes visible again (e.g. switching back from
  // Executive Overview or Import Center) - Radix Tabs keeps this component mounted rather than
  // destroying/recreating it on every tab switch, so a mount-only effect would only ever load
  // the data ONE time for the whole session and silently go stale after that, even though the
  // data on disk is fine. The visibilitychange listener additionally covers a full app restart
  // or window refocus, so newly imported/updated data is picked up without requiring a manual
  // Reload click in the common case.
  useEffect(() => {
    // Initial mount load only - this is the ONE legitimate place a full "loading" state (and
    // therefore the unmounted <p>Loading...</p> placeholder) makes sense, since there is no
    // existing ReportDataTable instance yet to preserve state in.
    loadTables();

    // FIX: pass { showSpinner: true } so a window refocus/visibility change reloads data via
    // the non-destructive `reloading` path instead of the `loading` path - see the
    // component-level comment above for the full explanation. ReportDataTable (and
    // CareDataHygieneReport, when active) stay mounted the entire time, so all of their local
    // filter/sort/column state survives untouched.
    function handleVisibility() {
      if (document.visibilityState === "visible") loadTables({ showSpinner: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [loadTables]);

  function handleImported() {
    loadTables({ showSpinner: true });
  }

  function handleManualReload() {
    loadTables({ showSpinner: true });
  }

  const selectedReport = REPORT_TYPES.find((r) => r.key === selectedType);
  const selectedTable = tables[selectedType] ?? null;
  const isCareSubscriptions = selectedType === "care_subscriptions";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Report Tables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 p-2">
          {REPORT_TYPES.map((report) => {
            const hasData = Boolean(tables[report.key]) || Boolean(report.secondaryImport && tables[report.secondaryImport.key]);
            return (
              <button
                key={report.key}
                onClick={() => setSelectedType(report.key)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedType === report.key ? "bg-indigo-50 font-medium text-indigo-700" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Table2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  {report.label}
                </span>
                {hasData && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {isCareSubscriptions && !loading && (
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
              <CareDataHygieneReport table={selectedTable} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{selectedReport?.label}</CardTitle>
            <div className="flex gap-2">
              {selectedReport?.secondaryImport && tables[selectedReport.secondaryImport.key] && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setClearConfirmTarget({ key: selectedReport.secondaryImport.key, label: selectedReport.secondaryImport.label })}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Clear Volume & AHT Data
                </Button>
              )}
              {tables[selectedType] && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => setClearConfirmTarget({ key: selectedType, label: selectedReport?.label })}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Clear Data
                </Button>
              )}
              {selectedReport?.secondaryImport && (
                <Button size="sm" variant="outline" onClick={() => setSecondaryImportDialogOpen(true)}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {selectedReport.secondaryImport.buttonLabel}
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
                reportType={selectedType}
                table={selectedTable}
                defaultSummaryFields={selectedReport?.defaultSummaryFields}
                defaultHiddenColumns={selectedReport?.defaultHiddenColumns}
                onReload={handleManualReload}
                isReloading={reloading}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <ImportAsTableDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        reportType={selectedType}
        reportLabel={selectedReport?.label}
        onImported={handleImported}
      />
      {selectedReport?.secondaryImport && (
        <ImportAsTableDialog
          open={secondaryImportDialogOpen}
          onOpenChange={setSecondaryImportDialogOpen}
          reportType={selectedReport.secondaryImport.key}
          reportLabel={selectedReport.secondaryImport.label}
          onImported={handleImported}
        />
      )}
      <AlertDialog open={Boolean(clearConfirmTarget)} onOpenChange={(open) => { if (!open) setClearConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear "{clearConfirmTarget?.label}" data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every row currently stored for this report, so a fresh
              import can start clean. This cannot be undone - you will need to re-import the
              report file to bring the data back.
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
