import {useCallback, useEffect, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import RoleGuard from "@/components/auth/RoleGuard";
import ReportDataTable from "@/components/supervisor/ReportDataTable";
import {DEFAULT_SUMMARY_FIELDS} from "@/components/supervisor/CareSubscriptionsTabPanel";
import {CARE_ACTIVE_TYPE, getActiveCareTable} from "@/features/supervisorDashboard/importedTableStore";

/**
 * Read-only list of ACTIVE Enphase Care subscriptions, open to every signed-in user. It reads the
 * compact active-only copy (see importedTableStore.js) that is derived from the Supervisor
 * Dashboard's full Care import and shared with every install. It offers no import, clear or
 * hygiene tools - those stay on the Supervisor Dashboard (admin only). Internal/test records are
 * already left out using the same rules the Care eligibility check uses.
 */
function EnphaseCareContent() {
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const loadTable = useCallback(async ({ showSpinner } = {}) => {
    if (showSpinner) setReloading(true); else setLoading(true);
    try {
      setTable(await getActiveCareTable());
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    loadTable();
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

  return (
    <div className="p-6 max-w-[112rem] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Enphase Care</h1>
        <p className="text-muted-foreground mt-1">
          Active Enphase Care subscriptions. Search by Site ID or customer name to confirm Care
          eligibility before an FST visit.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Active Subscriptions{table ? ` (${table.rows.length.toLocaleString()})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : !table ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No Care subscription data has been shared yet. A supervisor needs to import the Care
              Subscriptions report first.
            </p>
          ) : (
            <ReportDataTable
              reportType={CARE_ACTIVE_TYPE}
              table={table}
              defaultSummaryFields={DEFAULT_SUMMARY_FIELDS}
              defaultHiddenColumns={[]}
              onReload={() => loadTable({ showSpinner: true })}
              isReloading={reloading}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EnphaseCare() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin", "invoicer"]}>
      <EnphaseCareContent />
    </RoleGuard>
  );
}