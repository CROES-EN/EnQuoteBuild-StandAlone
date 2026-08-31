import { useState, useEffect } from "react";

const FILTERS_STORAGE_KEY = "quotes_filters";

function loadSavedFilters() {
  try {
    const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}
import { base44 } from "@/api/base44Client";
import { bulkUpdateQuotes } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link, useLocation} from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Search, Plus, FileText, SlidersHorizontal, Download, User, ChevronDown, ChevronUp, ListChecks, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import QuoteCard from "@/components/quotes/QuoteCard";
import QuoteStatusSnapshot from "@/components/quotes/QuoteStatusSnapshot";
import StatusAlerts from "@/components/dashboard/StatusAlerts";
import { computeQuoteAlert, userHasAlertAccess } from "@/utils/quoteSLA";
import BulkActionBar from "@/components/quotes/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { motion } from "framer-motion";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  { value: "scheduled", label: "Scheduled" },
  { value: "ho_rejected", label: "HO Rejected" },
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
    queryKey: ["quotes"],
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

  const { data: myMentions = [] } = useQuery({
    queryKey: ["quoteAlerts", "mentions", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const res = await base44.functions.invoke("manageQuoteAlerts", { action: "getMyAlerts" });
      return res?.data || [];
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

  const { data: dismissals = [] } = useQuery({
    queryKey: ["statusAlertDismissals"],
    queryFn: async () => {
      return await base44.entities.StatusAlertDismissal.list("-created_date", 500);
    },
  });

  const dismissedQuoteIds = new Set(dismissals.map((d) => d.quote_id));

  const dismissAlertMutation = useMutation({
    mutationFn: async (quoteId) => {
      await base44.entities.StatusAlertDismissal.create({ quote_id: quoteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statusAlertDismissals"] });
    },
  });

  // Get unique coordinators from quotes (use owner_email if set, else created_by)
  const coordinators = [...new Set(quotes.map(q => q.owner_email || q.created_by).filter(Boolean))].sort();

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

  const filteredQuotes = alertsOnly
    ? baseFilteredQuotes.filter((q) => {
        if (dismissedQuoteIds.has(q.id)) return false;
        const alert = computeQuoteAlert(q);
        return userHasAlertAccess(alert, q, user?.email, isAdmin) || mentionedQuoteIds.has(q.id);
      })
    : baseFilteredQuotes;

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Quotes</h1>
            <p className="text-slate-600 mt-1">View and manage all your quotes</p>
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
            <Button variant="outline" onClick={downloadCSV} className="border-slate-300">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Link to={createPageUrl("CreateQuote")}>
              <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200">
                <Plus className="w-4 h-4 mr-2" />
                New Quote
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
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
                  <SelectItem value="amount_desc">Amount: High â†’ Low</SelectItem>
                  <SelectItem value="amount_asc">Amount: Low â†’ High</SelectItem>
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
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                <div className="border-t border-slate-100 pt-4">
                  <button
                    onClick={() => setSnapshotExpanded(!snapshotExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {snapshotExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    Status Snapshot â€” {snapshotEmail.split("@")[0]}
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
            <span>Filters are active â€” some quotes may be hidden.</span>
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setCoordinatorFilter("all"); setMyQuotesOnly(false); setSelectedSubmitter("all"); setAlertsOnly(false); }}
              className="ml-auto font-medium underline hover:no-underline"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Status Alerts â€” reflects the currently filtered quote list */}
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
            <span className="text-slate-600 font-medium">
              Select all visible ({filteredQuotes.length})
            </span>
          </div>
        )}

        {/* Quotes Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="h-48 animate-pulse bg-slate-100" />
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
          <Card className="p-12 text-center border-slate-200">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No quotes found</h3>
            <p className="text-slate-600">
              {search || statusFilter !== "all" || coordinatorFilter !== "all" || myQuotesOnly || selectedSubmitter !== "all"
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