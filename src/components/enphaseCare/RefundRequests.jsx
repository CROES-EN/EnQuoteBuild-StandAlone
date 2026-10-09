import React, {useEffect, useMemo, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {AlertCircle, RefreshCw} from "lucide-react";
import {toast} from "sonner";
import {useUserRole} from "@/components/auth/RoleGuard";
import {refundRequestsApi} from "@/features/collab/collabApi";
import {REFUND_REQUEST_STATUSES, normalizeRefundStatus, filterRefundRequests, formatRefundAmount, formatRefundDate} from "@/features/refundRequests/refundRequestData";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";

const QUERY_KEY = ["refund-requests"];
const POLL_INTERVAL_MS = 30_000;
const EMPTY_FILTERS = {
  search: "",
  status: "",
  department: "",
  refundType: "",
  approvalRequired: "",
  submittedFrom: "",
  submittedThrough: ""
};

function FilterSelect({id, label, value, allLabel, options, onValueChange}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value ? `value:${value}` : "all"} onValueChange={(selected) => onValueChange(selected === "all" ? "" : selected.slice(6))}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={`value:${optionValue}`}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const SECTION_FIELDS = [
  ["Request Information", [
    ["Response ID", "externalResponseId"],
    ["Requestor Name", "requestorName"],
    ["Requestor Department", "requestorDepartment"],
    ["Requestor Email", "requestorEmail"],
    ["Submitted Date", "submittedAt", formatRefundDate],
    ["Last Updated", "lastUpdatedAt", formatRefundDate]
  ]],
  ["Customer Information", [
    ["Subscription ID", "subscriptionId"],
    ["Site ID", "siteId"],
    ["Customer Name", "customerName"],
    ["Customer Email", "customerEmail"],
    ["Case Number", "caseNumber"],
    ["Cancellation Timing", "cancellationTiming"],
    ["Refund Requested", "refundChoice"],
    ["Services Completed", "servicesCompleted"],
    ["Customer Escalated", "customerEscalated"],
    ["Other Reason", "otherReason"]
  ]],
  ["Refund Details", [
    ["Refund Amount Requested", "refundAmountRequested", formatRefundAmount],
    ["Refund Reason", "refundReason"],
    ["Site Visit Completed", "siteVisitCompleted", (value) => value ? "Yes" : "No"],
    ["Refund Type", "refundType"]
  ]],
  ["Approval Requirements", [
    ["Leadership Approval Required", "leadershipApprovalRequired", (value) => value ? "Yes" : "No"],
    ["Leadership Approval Justification", "leadershipApprovalJustification"]
  ]],
  ["Additional Information", [
    ["Additional Notes", "additionalNotes"]
  ]]
];

function StatusLabel({status}) {
  const styles = {
    Submitted: "border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950",
    "Under Review": "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950",
    Approved: "border-green-300 bg-green-50 text-green-900 dark:bg-green-950",
    Denied: "border-red-300 bg-red-50 text-red-900 dark:bg-red-950",
    Completed: "border-violet-300 bg-violet-50 text-violet-900 dark:bg-violet-950",
    Cancelled: "border-slate-300 bg-slate-100 text-slate-800 dark:bg-slate-800"
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status] || ""}`}>
      {status || "Unknown"}
    </span>
  );
}

function RefundRequestCard({request, canProcess, canApprove, onStatusChange, onOpen, saving}) {
  return (
    <Card className={`h-full border-l-4 ${request.status === "Submitted" ? "border-l-blue-500" : "border-l-border"}`}>
      <CardContent className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Button variant="link" className="h-auto max-w-full justify-start truncate p-0 text-left text-base font-semibold" onClick={onOpen}>
              {request.customerName || "Refund request"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">{request.externalResponseId}</p>
          </div>
          <StatusLabel status={request.status} />
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Subscription ID</p>
            <p className="truncate font-medium">{request.subscriptionId || "—"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Site ID</p>
            <p className="truncate font-medium">{request.siteId || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Requested</p>
            <p className="font-semibold">{formatRefundAmount(request.refundAmountRequested)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Refund type</p>
            <p className="font-medium">{request.refundType || "—"}</p>
          </div>
        </div>

        <div className="min-h-10 border-t border-border pt-3 text-sm">
          <p className="line-clamp-2">{request.refundReason || request.additionalNotes || "No reason provided."}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {request.requestorName || "Unknown requestor"}
            {request.requestorDepartment ? ` · ${request.requestorDepartment}` : ""}
            {" · "}{formatRefundDate(request.submittedAt)}
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-3">
          <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
            Change status
            <select
              aria-label={`Change status for ${request.externalResponseId}`}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={request.status}
              disabled={!(canProcess || canApprove) || saving}
              onChange={(event) => onStatusChange(request, event.target.value)}
            >
              {REFUND_REQUEST_STATUSES.map((status) => (
                <option key={status} value={status} disabled={status === "Approved" ? !canApprove : !canProcess}>{status}</option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" size="sm" onClick={onOpen}>Details</Button>
        </div>
        {request.missingEnQuoteFields?.length > 0 && (
          <p className="text-xs font-medium text-amber-800">Needs EnQuote details to be completed</p>
        )}
      </CardContent>
    </Card>
  );
}

function dateForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function ReadOnlySection({title, fields, request}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <dl className="divide-y divide-border rounded-md border border-border px-3">
        {fields.map(([label, key, formatter]) => (
          <div key={key} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-3">
            <dt className="font-medium text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap break-words sm:col-span-2">
              {formatter ? formatter(request[key]) : (request[key] || "—")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RequestDetail({request, onClose, canProcess, canApprove, onSave, saving}) {
  const [nextStatus, setNextStatus] = useState(request.status);
  const [storeTeamNotes, setStoreTeamNotes] = useState(request.storeTeamNotes || "");
  const [escalationNotes, setEscalationNotes] = useState(request.escalationNotes || "");
  const [paidAtDate, setPaidAtDate] = useState(() => dateForInput(request.refundProcessedDate));
  const [leadershipApprover, setLeadershipApprover] = useState(request.leadershipApprover || "");
  const [approvalDate, setApprovalDate] = useState(() => {
    if (!request.approvalDate) return "";
    const date = new Date(request.approvalDate);
    return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const canEdit = canProcess || canApprove;

  async function submit(event) {
    event.preventDefault();
    const changes = {};
    if (nextStatus !== request.status) changes.status = nextStatus;
    if (canProcess) {
      changes.storeTeamNotes = storeTeamNotes;
      changes.escalationNotes = escalationNotes;
      if (paidAtDate !== dateForInput(request.refundProcessedDate)) {
        changes.refundProcessedDate = paidAtDate ? new Date(`${paidAtDate}T12:00:00`).toISOString() : null;
      }
    }
    if (canApprove) {
      changes.leadershipApprover = leadershipApprover;
      changes.approvalDate = approvalDate ? new Date(approvalDate).toISOString() : null;
    }
    await onSave(changes);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refund Request</DialogTitle>
          <DialogDescription>
            {request.externalResponseId} · <StatusLabel status={request.status} />
          </DialogDescription>
        </DialogHeader>
        {request.leadershipApprovalRequired && (
          <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            Leadership approval required. {request.leadershipApprovalJustification || "No justification was supplied."}
          </div>
        )}
        {request.missingEnQuoteFields?.length > 0 && (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            This tracker row needs EnQuote details: {request.missingEnQuoteFields.map((field) => field.replaceAll(/([A-Z])/g, " $1").toLocaleLowerCase()).join(", ")}.
          </div>
        )}
        <form onSubmit={submit} className="space-y-5">
          {SECTION_FIELDS.map(([title, fields]) => <ReadOnlySection key={title} title={title} fields={fields} request={request} />)}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Processing</h3>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-muted-foreground">Paid at date</dt>
                <dd>{canProcess ? (
                  <Input
                    aria-label="Paid at date"
                    type="date"
                    value={paidAtDate}
                    onChange={(event) => setPaidAtDate(event.target.value)}
                    className="mt-1 max-w-xs"
                  />
                ) : formatRefundDate(request.refundProcessedDate)}</dd>
              </div>
              <div><dt className="font-medium text-muted-foreground">Processor Name</dt><dd>{request.processorName || "—"}</dd></div>
            </dl>
            {canProcess && (
              <>
                <label className="block space-y-1 text-sm font-medium">
                  Store Team Notes
                  <Textarea value={storeTeamNotes} onChange={(event) => setStoreTeamNotes(event.target.value)} maxLength={5000} rows={3} />
                </label>
                <label className="block space-y-1 text-sm font-medium">
                  Escalation Notes
                  <Textarea value={escalationNotes} onChange={(event) => setEscalationNotes(event.target.value)} maxLength={5000} rows={3} />
                </label>
              </>
            )}
            {canApprove && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Leadership Approver
                  <Input value={leadershipApprover} onChange={(event) => setLeadershipApprover(event.target.value)} maxLength={200} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Approval Date
                  <Input type="datetime-local" value={approvalDate} onChange={(event) => setApprovalDate(event.target.value)} />
                </label>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div><span className="font-medium text-muted-foreground">Leadership Approver:</span> {!canApprove && (request.leadershipApprover || "—")}</div>
              <div><span className="font-medium text-muted-foreground">Approval Date:</span> {!canApprove && formatRefundDate(request.approvalDate)}</div>
            </div>
            <label className="block space-y-1 text-sm font-medium">
              Request Status
              {canEdit ? (
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                  {REFUND_REQUEST_STATUSES.map((status) => (
                    <option key={status} value={status} disabled={status === "Approved" ? !canApprove : !canProcess}>{status}</option>
                  ))}
                </select>
              ) : <p className="pt-1 font-normal">{request.status}</p>}
            </label>
          </section>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            {canEdit && <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RefundRequests() {
  const queryClient = useQueryClient();
  const {roles, isAdmin, isSuperAdmin} = useUserRole();
  const canProcess = isAdmin || isSuperAdmin || roles.includes("invoicer");
  const canApprove = isAdmin || isSuperAdmin || roles.includes("approver");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [automaticSyncError, setAutomaticSyncError] = useState("");
  const desktopBridgeAvailable = Boolean(globalThis.window?.enquoteLocal?.refundRequests?.syncWorkbook);
  const requestsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: refundRequestsApi.list,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: false
  });
  const workbookStatusQuery = useQuery({
    queryKey: ["refund-workbook-status"],
    queryFn: refundRequestsApi.workbookStatus,
    enabled: desktopBridgeAvailable && canProcess,
    refetchInterval: POLL_INTERVAL_MS,
    retry: false
  });
  const workbookSyncQuery = useQuery({
    queryKey: ["refund-workbook-sync-status"],
    queryFn: refundRequestsApi.workbookSyncStatus,
    enabled: desktopBridgeAvailable && canProcess,
    retry: false
  });
  const workbookSyncMutation = useMutation({
    mutationFn: refundRequestsApi.syncWorkbook,
    onSuccess: async (result) => {
      const changedCount = result.imported + result.updated;
      toast.success(`Tracker sync complete: ${result.imported} imported, ${result.updated} updated, ${result.written} written to Excel, ${result.deleted || 0} removed.`);
      if (result.conflicts.length || result.serverConflicts.length) {
        toast.warning(`${result.conflicts.length + result.serverConflicts.length} sync conflict(s) need review.`);
      } else if (!changedCount && !result.written && !result.deleted) {
        toast.info("The refund tracker is already up to date.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["refund-workbook-sync-status"] })
      ]);
    },
    onError: async (error) => {
      toast.error(`Could not sync the refund tracker: ${error.message}`);
      await queryClient.invalidateQueries({ queryKey: ["refund-workbook-sync-status"] });
    }
  });
  const resolveConflictMutation = useMutation({
    mutationFn: refundRequestsApi.resolveWorkbookConflict,
    onSuccess: async () => {
      toast.success("Conflict resolved and tracker synced.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["refund-workbook-sync-status"] })
      ]);
    },
    onError: (error) => toast.error(`Could not resolve the sync conflict: ${error.message}`)
  });
  const updateMutation = useMutation({
    mutationFn: ({id, status, updatedAt, changes}) => refundRequestsApi.update(id, status, updatedAt, changes),
    onSuccess: async () => {
      if (canProcess && workbookStatusQuery.data?.configured) {
        try {
          const result = await refundRequestsApi.syncWorkbook();
          if (result.conflicts.length || result.serverConflicts.length) {
            toast.warning("Saved to EnQuote. A workbook conflict needs review before all edits can sync.");
          } else toast.success("Request updated in EnQuote and the Excel tracker.");
        } catch (error) {
          toast.error(`Saved to EnQuote, but Excel sync is pending: ${error.message}. Use Sync tracker to retry.`);
        }
        await queryClient.invalidateQueries({queryKey: ["refund-workbook-sync-status"]});
      } else {
        toast.warning("Saved to EnQuote. Excel sync will retry when the shared OneDrive tracker is available.");
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toast.error(`Could not update this refund request: ${error.message}`)
  });
  const requests = useMemo(() => (requestsQuery.data || []).map((request) => ({
    ...request, status: normalizeRefundStatus(request.status)
  })), [requestsQuery.data]);
  const visibleRequests = useMemo(() => filterRefundRequests(requests, filters), [requests, filters]);
  const selectedRequest = requests.find((request) => request.id === selectedId);

  useEffect(() => {
    const unsubscribe = globalThis.window?.enquoteLocal?.refundRequests?.onChanged?.(() => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
    return unsubscribe;
  }, [queryClient]);

  const connectedWorkbook = workbookStatusQuery.data?.path;
  useEffect(() => {
    if (!canProcess || !connectedWorkbook) return undefined;
    let active = true;
    let running = false;
    async function refreshTracker() {
      if (running || globalThis.document?.hidden) return;
      running = true;
      try {
        await refundRequestsApi.syncWorkbook();
        if (active) {
          setAutomaticSyncError("");
          await Promise.all([
            queryClient.invalidateQueries({queryKey: QUERY_KEY}),
            queryClient.invalidateQueries({queryKey: ["refund-workbook-sync-status"]})
          ]);
        }
      } catch (error) {
        if (active) setAutomaticSyncError(`Automatic Excel sync is pending: ${error.message}`);
      } finally {running = false;}
    }
    void refreshTracker();
    const timer = setInterval(refreshTracker, POLL_INTERVAL_MS);
    return () => {active = false; clearInterval(timer);};
  }, [canProcess, connectedWorkbook, queryClient]);

  function setFilter(name, value) {
    setFilters((previous) => ({ ...previous, [name]: value }));
  }

  async function saveChanges(changes) {
    await updateMutation.mutateAsync({
      id: selectedRequest.id,
      status: selectedRequest.status,
      updatedAt: selectedRequest.lastUpdatedAt,
      changes
    });
    setSelectedId(null);
  }

  function changeRequestStatus(request, status) {
    if (!status || status === request.status) return;
    updateMutation.mutate({
      id: request.id,
      status: request.status,
      updatedAt: request.lastUpdatedAt,
      changes: {status}
    });
  }

  const departments = [...new Set(requests.map((request) => request.requestorDepartment).filter(Boolean))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Refund Requests{requests.length ? ` (${requests.length})` : ""}</h2>
          <p className="text-sm text-muted-foreground">Requests and the connected Excel tracker refresh every 30 seconds while this tab is active.</p>
        </div>
        <Button variant="outline" onClick={() => requestsQuery.refetch()} disabled={requestsQuery.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${requestsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {requestsQuery.isError && requests.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The latest refresh failed: {requestsQuery.error.message}. Your previously loaded requests are still shown. Try Refresh again.</span>
        </div>
      )}

      {canProcess && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {automaticSyncError && <p role="alert" className="text-sm text-destructive">{automaticSyncError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">SharePoint refund tracker</h3>
                <p className="text-sm text-muted-foreground">
                  The shared tracker connects automatically from your work OneDrive account. Your EnQuote account
                  must also have the invoicer or administrator role. Sync from one PC at a time and
                  wait for OneDrive to finish before another person starts.
                </p>
                {workbookStatusQuery.data?.configured && (
                  <p className="mt-1 break-all text-xs text-muted-foreground">{workbookStatusQuery.data.path}</p>
                )}
                {workbookSyncQuery.data?.lastSyncedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">Last synced {formatRefundDate(workbookSyncQuery.data.lastSyncedAt)}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => workbookSyncMutation.mutate()}
                  disabled={!workbookStatusQuery.data?.configured || workbookSyncMutation.isPending}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${workbookSyncMutation.isPending ? "animate-spin" : ""}`} />
                  {workbookSyncMutation.isPending ? "Syncing..." : "Sync tracker"}
                </Button>
              </div>
            </div>
            {!desktopBridgeAvailable && (
              <p role="alert" className="text-sm text-amber-800">
                The EnQuote desktop connection did not load. Fully close all EnQuote windows and
                restart <code>npm run desktop:dev</code>. This feature is not available in a browser preview.
              </p>
            )}
            {(workbookStatusQuery.error || workbookStatusQuery.data?.error) && (
              <p role="alert" className="text-sm text-destructive">{workbookStatusQuery.error?.message || workbookStatusQuery.data.error}</p>
            )}
            {(workbookSyncQuery.data?.invalidRows || []).length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Fix these workbook rows before syncing: {workbookSyncQuery.data.invalidRows.map((row) =>
                  `Table row ${row.tableRow || "unknown"}: ${row.externalResponseId ? `duplicate ID ${row.externalResponseId}` : "missing ID"}`
                ).join("; ")}.
              </p>
            )}
            {(workbookSyncQuery.data?.serverConflicts || []).length > 0 && (
              <p role="status" className="text-sm text-amber-800">
                Some records changed on the sync service during this operation. Run Sync tracker again to refresh and review any field conflicts.
              </p>
            )}
            {(workbookSyncQuery.data?.conflicts || []).length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                <h4 className="text-sm font-semibold">Conflicts to review</h4>
                {workbookSyncQuery.data.conflicts.map((conflict) => {
                  const displayValue = (value) => typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—");
                  return (
                    <div key={`${conflict.externalResponseId}:${conflict.field}`} className="rounded-md border border-amber-300 p-3 text-sm">
                      <p className="font-medium">{conflict.externalResponseId} · {conflict.field.replaceAll(/([A-Z])/g, " $1")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={resolveConflictMutation.isPending}
                          onClick={() => resolveConflictMutation.mutate({
                            externalResponseId: conflict.externalResponseId,
                            field: conflict.field,
                            choice: "workbook"
                          })}
                        >
                          Use workbook: {displayValue(conflict.workbookValue)}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={resolveConflictMutation.isPending}
                          onClick={() => resolveConflictMutation.mutate({
                            externalResponseId: conflict.externalResponseId,
                            field: conflict.field,
                            choice: "enquote"
                          })}
                        >
                          Use EnQuote: {displayValue(conflict.enquoteValue)}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium sm:col-span-2">
              Search requests
              <Input aria-label="Search refund requests" placeholder="Subscription, site, customer, requestor or email" value={filters.search} onChange={(event) => setFilter("search", event.target.value)} />
            </label>
            <FilterSelect
              id="refund-filter-status" label="Request Status" value={filters.status} allLabel="All statuses"
              options={REFUND_REQUEST_STATUSES.map((status) => [status, status])}
              onValueChange={(value) => setFilter("status", value)}
            />
            <FilterSelect
              id="refund-filter-department" label="Requestor Department" value={filters.department} allLabel="All departments"
              options={departments.map((department) => [department, department])}
              onValueChange={(value) => setFilter("department", value)}
            />
            <FilterSelect
              id="refund-filter-type" label="Refund Type" value={filters.refundType} allLabel="All types"
              options={["Full Refund", "Partial Refund"].map((type) => [type, type])}
              onValueChange={(value) => setFilter("refundType", value)}
            />
            <FilterSelect
              id="refund-filter-approval" label="Leadership Approval" value={filters.approvalRequired} allLabel="All requests"
              options={[["yes", "Required"], ["no", "Not required"]]}
              onValueChange={(value) => setFilter("approvalRequired", value)}
            />
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
              Submitted from
              <Input type="date" value={filters.submittedFrom} onChange={(event) => setFilter("submittedFrom", event.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
              Submitted through
              <Input type="date" value={filters.submittedThrough} onChange={(event) => setFilter("submittedThrough", event.target.value)} />
            </label>
          </div>

          {requestsQuery.isLoading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading refund requests...
            </div>
          ) : requestsQuery.isError && requests.length === 0 ? (
            <div role="alert" className="py-8 text-center text-sm text-destructive">
              Could not load refund requests: {requestsQuery.error.message}. Check your EnQuote connection and refresh.
            </div>
          ) : requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No refund requests have been submitted yet.</p>
          ) : visibleRequests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No refund requests match these filters.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleRequests.map((request) => (
                <RefundRequestCard
                  key={request.id}
                  request={request}
                  canProcess={canProcess}
                  canApprove={canApprove}
                  onStatusChange={changeRequestStatus}
                  onOpen={() => setSelectedId(request.id)}
                  saving={updateMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {selectedRequest && (
        <RequestDetail
          key={selectedRequest.id}
          request={selectedRequest}
          onClose={() => setSelectedId(null)}
          canProcess={canProcess}
          canApprove={canApprove}
          onSave={saveChanges}
          saving={updateMutation.isPending}
        />
      )}
    </div>
  );
}
