import React, {useEffect, useState} from "react";
import {bulkUpdateQuotes, createLocalRecord, getQuotes, listLocalCollection} from "@/api/dataClient";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Link, useLocation} from "react-router-dom";
import {createPageUrl} from "@/utils";
import {AlertCircle, ChevronDown, ChevronUp, Download, FileText, ListChecks, Plus, Search, User} from "lucide-react";
import {cn} from "@/lib/utils";
import QuoteCard from "@/components/quotes/QuoteCard";
import QuoteStatusSnapshot from "@/components/quotes/QuoteStatusSnapshot";
import StatusAlerts from "@/components/dashboard/StatusAlerts";
import {computeQuoteAlert, userHasAlertAccess} from "@/utils/quoteSLA";
import BulkActionBar from "@/components/quotes/BulkActionBar";
import {Checkbox} from "@/components/ui/checkbox";
import {useToast} from "@/components/ui/use-toast";
import RoleGuard, {useUserRole} from "@/components/auth/RoleGuard";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";

const FILTERS_STORAGE_KEY = "quotes_filters";

function loadSavedFilters() {
  try {
    const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

const statusFilters = [
  { value: "all", label: "All Quotes" },
  { value: "draft_without_internal", label: "Quote Draft" },
  { value: "draft_without_fst", label: "Quote Missing Details" },
  { value: "submitted", label: "Quote Pending Approval" },
  { value: "approved", label: "Quote Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "quote_sent_to_ho", label: "Quote Sent to HO" },
  { value: "ho_approved_invoice_required", label: "HO Approved, Invoice Required" },
  { value: "invoiced", label: "Quote Pending Payment" },
  { value: "invoice_paid", label: "Invoice Paid" },
  { value: "invoice_paid_materials_required", label: "Invoice Paid - Materials Required" },
  { value: "materials_pending_shipment", label: "Materials Pending Shipment" },
  { value: "scheduled", label: "Scheduled" },
  { value: "ho_rejected", label: "HO Rejected" },
  { value: "pending_materials", label: "Pending Materials" },
  { value: "on_hold", label: "Boneyard (On Hold)" }
];

function QuotesContent() {
  const savedFilters = loadSavedFilters();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const rawInitialStatus = urlParams.get("status") || savedFilters.statusFilter || "all";
  const validStatusValues = statusFilters.map(f => f.value);
  const initialStatus = validStatusValues.includes(rawInitialStatus) ? rawInitialStatus : "all";

  const { user, isApprover, isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(savedFilters.search || "");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [coordinatorFilter, setCoordinatorFilter] = useState(savedFilters.coordinatorFilter || "all");
  const [sortBy, setSortBy] = useState(savedFilters.sortBy || "date_desc");
  const [myQuotesOnly, setMyQuotesOnly] = useState(savedFilters.myQuotesOnly || false);
  const [selectedSubmitter, setSelectedSubmitter] = useState(savedFilters.selectedSubmitter || "all");
  const [snapshotExpanded, setSnapshotExpanded] = useState(true);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  useEffect(() => {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ search, statusFilter, coordinatorFilter, sortBy, myQuotesOnly, selectedSubmitter }));
  }, [search, statusFilter, coordinatorFilter, sortBy, myQuotesOnly, selectedSubmitter]);

  const downloadCSV = () => {
    const headers = ["Quote Number", "Site ID", "Case Number", "Agent", "Status", "Total", "Stripe Transaction ID", "Stripe Invoice ID", "Paid At Date", "Created Date", "Last Modified Date"];
    const rows = filteredQuotes.map(q => [
      q.quote_number || "",
      q.site_id || "",
      q.case_number || "",
      q.owner_email || q.created_by || "",
      q.status || "",
      q.total != null ? q.total.toFixed(2) : "",
      q.stripe_transaction_id || "",
      q.stripe_invoice_id || "",
      q.paid_at_date ? new Date(q.paid_at_date).toLocaleString() : "",
      q.created_date ? new Date(q.created_date).toLocaleString() : "",
      q.updated_date ? new Date(q.updated_date).toLocaleString() : ""
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quotes_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  const { data: quotes = [], isLoading, error } = useQuery({
    queryKey: ["quotes", "list"],
    queryFn: async () => {
      const allQuotes = await getQuotes();
      return allQuotes
        .filter(q => q.is_current_version !== false)
        .map(q => ({
          ...q,
          status: (!q.status || q.status === "draft") ? "draft_without_internal" : q.status
        }));
    }
  });

  // Diagnostic only - purely additive, does not change any existing behavior. If the quotes
  // query ever fails (network issue, thrown exception inside queryFn, etc.), this makes the
  // REAL error visible instead of silently rendering "No quotes found" with zero indication
  // anything went wrong - `error` was already being captured by useQuery above but was never
  // logged or displayed anywhere, so a real failure was previously indistinguishable from
  // "there just aren't any quotes."
  useEffect(() => {
    if (error) {
      console.error("[Quotes] Failed to load quotes:", error);
    }
  }, [error]);

  // FIX (confirmed root cause): this previously called
  // base44.functions.invoke("manageQuoteAlerts", ...) directly. base44.functions.invoke
  // CANNOT work at all in desktop/local mode -- there is no serverless Base44 backend to
  // call locally -- so this always silently failed, meaning @mentions have never worked
  // on desktop. Routed through the local "quoteAlerts" collection instead (registered in
  // repository.cjs's collectionNames), filtering client-side for this user's own
  // unresolved mentions -- mirrors exactly what manageQuoteAlerts' "getMyAlerts" action
  // does server-side on the web.
  const { data: myMentions = [] } = useQuery({
    queryKey: ["quoteAlerts", "mentions", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const allAlerts = await listLocalCollection("quoteAlerts");
      return (allAlerts || []).filter(
        (a) => a.mentioned_email === user.email && !a.is_resolved
      );
    },
    enabled: !!user?.email,
  });

  const mentionedQuoteIds = new Set(myMentions.map((m) => m.quote_id));
  const mentionMap = new Map();
  myMentions.forEach((m) => {
    const rank = { yellow: 1, orange: 2, red: 3 };
    const existing = mentionMap.get(m.quote_id);
    if (!existing || rank[m.priority] > rank[existing.priority]) {
      mentionMap.set(m.quote_id, m);
    }
  });

  // FIX (same confirmed root cause already fixed in StatusAlerts.jsx): this is a
  // SEPARATE query living in this file -- fixing StatusAlerts.jsx's copy did not fix
  // this one. Routed through listLocalCollection(), the same function every other
  // working collection uses.
  const { data: dismissals = [] } = useQuery({
    queryKey: ["statusAlertDismissals"],
    queryFn: async () => {
      return await listLocalCollection("statusAlertDismissals");
    },
  });

  const dismissedQuoteIds = new Set(dismissals.map((d) => d.quote_id));

  const dismissAlertMutation = useMutation({
    mutationFn: async (quoteId) => {
      await createLocalRecord("statusAlertDismissals", { quote_id: quoteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    },
  });

  // Get unique coordinators from quotes (use owner_email if set, else created_by)
  const coordinators = [...new Set(quotes.map(q => q.owner_email || q.created_by).filter(Boolean))].sort();

  // Groups the FULL, unfiltered quotes list by (site_id, total) and flags any site with 2+
  // quotes sharing the EXACT SAME total - per explicit, simplified design decision: "All I
  // simply needed the duplicate quote button to do was show if a site ID and a quote total
  // had the same exact values." This REPLACES the earlier distinct-quote_number-count logic
  // entirely - quote_number is no longer part of the duplicate check at all. Total is rounded
  // to 2 decimals before comparing, so ordinary floating-point representation differences
  // (e.g. 100.1 vs 100.10000000001) never cause a false negative/positive on an otherwise
  // identical dollar amount.
  const duplicateSiteIds = (() => {
    const totalsBySite = new Map();
    quotes.forEach((q) => {
      const site = q.site_id;
      if (!site || q.total === null || q.total === undefined) return;
      const roundedTotal = Math.round(Number(q.total) * 100) / 100;
      if (!totalsBySite.has(site)) totalsBySite.set(site, new Map());
      const totalCounts = totalsBySite.get(site);
      totalCounts.set(roundedTotal, (totalCounts.get(roundedTotal) || 0) + 1);
    });
    return new Set(
      Array.from(totalsBySite.entries())
        .filter(([, totalCounts]) => Array.from(totalCounts.values()).some((count) => count >= 2))
        .map(([site]) => site)
    );
  })();

  const baseFilteredQuotes = quotes.filter((quote) => {
    const effectiveOwner = quote.owner_email || quote.created_by;
    const matchesSearch = 
      quote.site_id?.toLowerCase().includes(search.toLowerCase()) ||
      quote.case_number?.toLowerCase().includes(search.toLowerCase()) ||
      quote.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      quote.quote_number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || quote.status === statusFilter;
    const matchesCoordinator = coordinatorFilter === "all" || effectiveOwner === coordinatorFilter;
    const matchesMyQuotes = !myQuotesOnly || effectiveOwner === user?.email;
    const matchesSubmitter = selectedSubmitter === "all" || effectiveOwner === selectedSubmitter;
    return matchesSearch && matchesStatus && matchesCoordinator && matchesMyQuotes && matchesSubmitter;
  }).sort((a, b) => {
    if (sortBy === "date_desc") return new Date(b.created_date) - new Date(a.created_date);
    if (sortBy === "date_asc") return new Date(a.created_date) - new Date(b.created_date);
    if (sortBy === "amount_desc") return (b.total || 0) - (a.total || 0);
    if (sortBy === "amount_asc") return (a.total || 0) - (b.total || 0);
    return 0;
  });

  const alertsFilteredQuotes = alertsOnly
    ? baseFilteredQuotes.filter((q) => {
        if (dismissedQuoteIds.has(q.id)) return false;
        const alert = computeQuoteAlert(q);
        return userHasAlertAccess(alert, q, user?.email, isAdmin) || mentionedQuoteIds.has(q.id);
      })
    : baseFilteredQuotes;

  const filteredQuotes = duplicatesOnly
    ? alertsFilteredQuotes.filter((q) => duplicateSiteIds.has(q.site_id))
    : alertsFilteredQuotes;

  const alertCount = quotes.filter((q) => {
    if (dismissedQuoteIds.has(q.id)) return false;
    const alert = computeQuoteAlert(q);
    return userHasAlertAccess(alert, q, user?.email, isAdmin) || mentionedQuoteIds.has(q.id);
  }).length;

  // --- Bulk selection & status update ---
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");

  const BULK_STATUS_OPTIONS = [
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "quote_sent_to_ho", label: "Sent to HO" },
    { value: "ho_approved_invoice_required", label: "HO Approved - Invoice Required" },
    { value: "invoiced", label: "Invoiced" },
    { value: "scheduled", label: "Scheduled" },

  ];
  const allowedBulkStatuses = isApprover
    ? BULK_STATUS_OPTIONS
    : BULK_STATUS_OPTIONS.filter((o) => !["invoiced", "invoice_paid"].includes(o.value));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatus("");
  };
  const exitBulkMode = () => {
    setBulkMode(false);
    clearSelection();
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, newStatus, userEmail }) => {
      const now = new Date().toISOString();
      const updates = ids.map((id) => {
        const quote = quotes.find((q) => q.id === id);
        const history = quote?.status_history || [];
        const payload = {
          id,
          status: newStatus,
          status_history: [
            ...history,
            { status: newStatus, changed_by: userEmail, changed_at: now, entry_type: "status_change" },
          ],
        };
        if (newStatus === "approved") {
          payload.approved_date = now;
          payload.approved_by = userEmail;
        }
        if (newStatus === "invoiced") payload.invoiced_date = now;
        if (newStatus === "invoice_paid") payload.invoice_paid_date = now;
        if (newStatus === "submitted") payload.submitted_date = now;
        if (newStatus === "quote_sent_to_ho") payload.quote_sent_to_ho_date = now;
        if (newStatus === "ho_approved_invoice_required") payload.ho_approved_date = now;
        if (newStatus === "scheduled") payload.scheduled_date = now;
        return payload;
      });
      return bulkUpdateQuotes(updates);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({
        title: `${variables.ids.length} quote${variables.ids.length > 1 ? "s" : ""} updated`,
        description: `Status set to ${BULK_STATUS_OPTIONS.find((o) => o.value === variables.newStatus)?.label}`,
      });
      exitBulkMode();
    },
    onError: (error) => {
      toast({ title: "Bulk update failed", description: error.message, variant: "destructive" });
    },
  });

  const handleApplyBulk = () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    bulkUpdateMutation.mutate({ ids: [...selectedIds], newStatus: bulkStatus, userEmail: user?.email });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
            <p className="text-muted-foreground mt-1">View and manage all your quotes</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={alertsOnly ? "default" : "outline"}
              onClick={() => setAlertsOnly(!alertsOnly)}
              className={alertsOnly ? "bg-amber-500 hover:bg-amber-600" : "border-amber-300 text-amber-700 hover:bg-amber-50"}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Alerts
              {alertCount > 0 && (
                <span className="ml-1.5 flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold">
                  {alertCount}
                </span>
              )}
            </Button>
            <Button
              variant={bulkMode ? "default" : "outline"}
              onClick={() => (bulkMode ? exitBulkMode() : setBulkMode(true))}
              className={bulkMode ? "bg-indigo-600 hover:bg-indigo-700" : "border-slate-300"}
            >
              <ListChecks className="w-4 h-4 mr-2" />
              {bulkMode ? "Done" : "Select"}
            </Button>
            <Button
              variant={duplicatesOnly ? "default" : "outline"}
              onClick={() => setDuplicatesOnly((prev) => !prev)}
              className={duplicatesOnly ? "bg-amber-600 hover:bg-amber-700" : "border-slate-300"}
              title="Sites with 2 or more quotes that share the exact same total"
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Show Duplicates{quotes.filter((q) => duplicateSiteIds.has(q.site_id)).length > 0 ? ` (${quotes.filter((q) => duplicateSiteIds.has(q.site_id)).length})` : ""}
            </Button>
            <Button variant="outline" onClick={downloadCSV} className="border-slate-300">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Link to={createPageUrl("CreateQuote")}>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                New Quote
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 border-border">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Site ID, Case Number, or Client Name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">Newest First</SelectItem>
                  <SelectItem value="date_asc">Oldest First</SelectItem>
                  <SelectItem value="amount_desc">Amount: High to Low</SelectItem>
                  <SelectItem value="amount_asc">Amount: Low to High</SelectItem>
                </SelectContent>
              </Select>
              <Select value={coordinatorFilter} onValueChange={setCoordinatorFilter}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue placeholder="Filter by Coordinator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Coordinators</SelectItem>
                  {coordinators.map((coordinator) => (
                    <SelectItem key={coordinator} value={coordinator}>
                      {coordinator}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isApprover && (
                <Select value={selectedSubmitter} onValueChange={setSelectedSubmitter}>
                  <SelectTrigger className="w-full md:w-64">
                    <SelectValue placeholder="Select Submitter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Submitters</SelectItem>
                    {coordinators.map((submitter) => (
                      <SelectItem key={submitter} value={submitter}>
                        {submitter}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
              <button
                onClick={() => setMyQuotesOnly(!myQuotesOnly)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
                  myQuotesOnly
                    ? "bg-indigo-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-slate-200"
                )}
              >
                <User className="w-4 h-4" />
                My Quotes
              </button>
              {statusFilters.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    statusFilter === filter.value
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-muted text-muted-foreground hover:bg-slate-200"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Collapsible Status Snapshot */}
            {(() => {
              const snapshotEmail = selectedSubmitter !== "all"
                ? selectedSubmitter
                : (myQuotesOnly ? user?.email : null);
              if (!snapshotEmail) return null;
              return (
                <div className="border-t border-border pt-4">
                  <button
                    onClick={() => setSnapshotExpanded(!snapshotExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground"
                  >
                    {snapshotExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4"/>}
                    Status Snapshot - {snapshotEmail.split("@")[0]}
                  </button>
                  {snapshotExpanded && (
                    <div className="mt-4">
                      <QuoteStatusSnapshot
                        quotes={quotes.filter(q => (q.owner_email || q.created_by) === snapshotEmail)}
                        activeStatus={statusFilter}
                        onSelectStatus={setStatusFilter}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </Card>

        {/* Active filter warning */}
        {(statusFilter !== "all" || coordinatorFilter !== "all" || search || myQuotesOnly || selectedSubmitter !== "all" || alertsOnly) && (
          <div className="flex items-center gap-2 mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <span>Filters are active - some quotes may be hidden.</span>
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setCoordinatorFilter("all"); setMyQuotesOnly(false); setSelectedSubmitter("all"); setAlertsOnly(false); }}
              className="ml-auto font-medium underline hover:no-underline"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Load error banner - purely additive; only ever shows if the quotes query actually
            failed. See the useEffect above for the matching console.error - together these
            make a real fetch failure immediately visible instead of silently looking like
            "there are just no quotes." */}
        {error && (
          <Card className="p-4 mb-4 border-rose-300 bg-rose-50">
            <p className="font-semibold text-rose-800 mb-1">Could not load quotes</p>
            <p className="text-sm text-rose-700">{error?.message || String(error)}</p>
          </Card>
        )}

        {/* Status Alerts - reflects the currently filtered quote list */}
        <StatusAlerts quotes={filteredQuotes} />

        {/* Bulk select-all control */}
        {bulkMode && !isLoading && filteredQuotes.length > 0 && (
          <div className="flex items-center gap-3 mb-4 text-sm">
            <Checkbox
              checked={filteredQuotes.length > 0 && filteredQuotes.every((q) => selectedIds.has(q.id))}
              onCheckedChange={(checked) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (checked) {
                    filteredQuotes.forEach((q) => next.add(q.id));
                  } else {
                    filteredQuotes.forEach((q) => next.delete(q.id));
                  }
                  return next;
                });
              }}
            />
            <span className="text-muted-foreground font-medium">
              Select all visible ({filteredQuotes.length})
            </span>
          </div>
        )}

        {/* Quotes Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="h-48 animate-pulse bg-muted" />
            ))}
          </div>
        ) : filteredQuotes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredQuotes.map((quote, index) => {
              const alert = computeQuoteAlert(quote);
              const hasAlertAccess = userHasAlertAccess(alert, quote, user?.email, isAdmin);
              const isDismissed = dismissedQuoteIds.has(quote.id);
              const mention = mentionMap.get(quote.id);
              return (
                <QuoteCard
                  key={quote.id}
                  quote={quote}
                  index={index}
                  selectable={bulkMode}
                  isSelected={selectedIds.has(quote.id)}
                  onToggleSelect={toggleSelect}
                  alert={hasAlertAccess && !isDismissed ? alert : null}
                  hasMention={!!mention}
                  mentionPriority={mention?.priority}
                  mentionMessage={mention?.message}
                  mentionedBy={mention?.mentioned_by}
                  onClearAlert={(quoteId) => dismissAlertMutation.mutate(quoteId)}
                />
              );
            })}
          </div>
        ) : (
          <Card className="p-12 text-center border-border">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No quotes found</h3>
            <p className="text-muted-foreground">
              {search || statusFilter !== "all" || coordinatorFilter !== "all" || myQuotesOnly || selectedSubmitter !== "all" || duplicatesOnly
                ? "Try adjusting your filters" 
                : "Create your first quote to get started"}
            </p>
          </Card>
        )}

        {/* Bulk action bar */}
        {bulkMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            statusOptions={allowedBulkStatuses}
            bulkStatus={bulkStatus}
            onBulkStatusChange={setBulkStatus}
            onApply={handleApplyBulk}
            onClear={clearSelection}
            isPending={bulkUpdateMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

export default function Quotes() {
  return (
    <RoleGuard>
      <QuotesContent />
    </RoleGuard>
  );
}
