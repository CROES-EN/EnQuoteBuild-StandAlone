import React, {useCallback, useEffect, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import RoleGuard from "@/components/auth/RoleGuard";
import ReportDataTable from "@/components/supervisor/ReportDataTable";
import {DEFAULT_SUMMARY_FIELDS} from "@/components/supervisor/CareSubscriptionsTabPanel";
import {CARE_ACTIVE_TYPE, getActiveCareTable} from "@/features/supervisorDashboard/importedTableStore";
import RefundRequests from "@/components/enphaseCare/RefundRequests";
import RefundRequestForm from "@/components/enphaseCare/RefundRequestForm";
import refundFeature from "../../shared/refundFeature.json";

/**
 * Read-only list of ACTIVE Enphase Care subscriptions, open to every signed-in user. It reads the
 * compact active-only copy (see importedTableStore.js) that is derived from the Supervisor
 * Dashboard's full Care import and shared with every install. It offers no import, clear or
 * hygiene tools - those stay on the Supervisor Dashboard (admin only). Internal/test records are
 * already left out using the same rules the Care eligibility check uses.
 */
function EnphaseCareContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const supportsRefundRequests = Boolean(
    globalThis.window?.enquoteLocal?.refundRequests?.list &&
    globalThis.window?.enquoteLocal?.refundRequests?.submit &&
    globalThis.window?.enquoteLocal?.refundRequests?.update &&
    globalThis.window?.enquoteLocal?.refundRequests?.onChanged
  );
  const requestedTab = searchParams.get("tab");
  const activeTab = refundFeature.enabled && ["refund-requests", "refund-submit"].includes(requestedTab)
    ? requestedTab
    : "subscriptions";
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
          {refundFeature.enabled
            ? "Manage active Enphase Care subscriptions and review customer refund requests."
            : "View active Enphase Care subscriptions."}
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams((previous) => {
          const next = new URLSearchParams(previous);
          if (value === "subscriptions") next.delete("tab");
          else next.set("tab", value);
          return next;
        })}
        className="space-y-4"
      >
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="subscriptions">Active Subscriptions</TabsTrigger>
          {refundFeature.enabled && <TabsTrigger value="refund-submit">Submit Request</TabsTrigger>}
          {refundFeature.enabled && <TabsTrigger value="refund-requests">Refund Requests</TabsTrigger>}
        </TabsList>
        <TabsContent value="subscriptions">
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
        </TabsContent>
        {refundFeature.enabled && <TabsContent value="refund-submit">
          <RefundRequestForm />
        </TabsContent>}
        {refundFeature.enabled && <TabsContent value="refund-requests">
          {supportsRefundRequests ? (
            <RefundRequests />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Refund Requests is not enabled in this running EnQuote session. If you are using
                <code className="mx-1 rounded bg-muted px-1 py-0.5">npm run desktop:dev</code>,
                close the app completely and restart it so Electron loads the current preload.
                This feature is available in the EnQuote desktop app, not a browser preview.
              </CardContent>
            </Card>
          )}
        </TabsContent>}
      </Tabs>
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