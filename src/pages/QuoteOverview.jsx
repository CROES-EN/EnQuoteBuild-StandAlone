import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation} from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Search, FolderOpen, FolderCheck, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/quotes/StatusBadge";
import RoleGuard from "@/components/auth/RoleGuard";
import { format } from "date-fns";

const OPEN_STATUSES = [
  { value: "draft_without_internal", label: "Draft w/o Internal", color: "bg-slate-100" },
  { value: "draft_without_fst",      label: "Draft w/o FST",      color: "bg-slate-100" },
  { value: "submitted",              label: "Submitted",           color: "bg-blue-50" },
  { value: "approved",               label: "Approved",            color: "bg-emerald-50" },
  { value: "rejected",               label: "Rejected",            color: "bg-rose-50" },
  { value: "quote_sent_to_ho",       label: "Sent to HO",          color: "bg-purple-50" },
  { value: "ho_approved_invoice_required", label: "HO Approved",   color: "bg-amber-50" },
  { value: "ho_rejected",            label: "HO Rejected",         color: "bg-red-50" },
  { value: "invoiced",               label: "Invoiced",            color: "bg-indigo-50" },
];

const CLOSED_STATUSES = [
  { value: "invoice_paid", label: "Invoice Paid", color: "bg-green-50" },
  { value: "scheduled", label: "Scheduled", color: "bg-teal-50" },
];

function QuoteOverviewContent() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const bucket = urlParams.get("bucket") === "closed" ? "closed" : "open";

  const [search, setSearch] = useState("");

  const { data: quotes = [], isLoading } = useQuery({
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

  const isOpen = bucket === "open";
  const bucketQuotes = quotes.filter(q =>
    isOpen ? !["invoice_paid", "scheduled"].includes(q.status) : ["invoice_paid", "scheduled"].includes(q.status)
  );

  const statusGroups = isOpen ? OPEN_STATUSES : CLOSED_STATUSES;

  const searchedQuotes = bucketQuotes.filter(q =>
    !search ||
    q.site_id?.toLowerCase().includes(search.toLowerCase()) ||
    q.quote_number?.toLowerCase().includes(search.toLowerCase()) ||
    q.case_number?.toLowerCase().includes(search.toLowerCase())
  );

  const totalValue = bucketQuotes.reduce((s, q) => s + (q.total || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <Link to={createPageUrl("Dashboard")}>
              <Button variant="ghost" className="text-slate-600 mb-2 -ml-2">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              {isOpen
                ? <FolderOpen className="w-8 h-8 text-amber-500" />
                : <FolderCheck className="w-8 h-8 text-emerald-500" />
              }
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  {isOpen ? "Open Quotes" : "Closed Quotes"}
                </h1>
                <p className="text-slate-600 mt-0.5">
                  {bucketQuotes.length} quote{bucketQuotes.length !== 1 ? "s" : ""} &middot; ${(totalValue / 1000).toFixed(1)}k total value
                </p>
              </div>
            </div>
          </div>

          {/* Toggle between Open / Closed */}
          <div className="flex gap-2">
            <Link to={createPageUrl("QuoteOverview?bucket=open")}>
              <Button
                variant={isOpen ? "default" : "outline"}
                className={isOpen ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </Button>
            </Link>
            <Link to={createPageUrl("QuoteOverview?bucket=closed")}>
              <Button
                variant={!isOpen ? "default" : "outline"}
                className={!isOpen ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
              >
                <FolderCheck className="w-4 h-4 mr-2" />
                Closed
              </Button>
            </Link>
          </div>
        </div>

        {/* Search */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by Site ID, Quote #, or Case #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </Card>

        {/* Status Buckets */}
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="h-32 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {statusGroups.map(({ value, label, color }) => {
              const group = searchedQuotes.filter(q => q.status === value);
              if (group.length === 0) return null;
              return (
                <div key={value}>
                  <div className="flex items-center gap-3 mb-3">
                    <StatusBadge status={value} />
                    <span className="text-sm text-slate-500">{group.length} quote{group.length !== 1 ? "s" : ""}</span>
                    <span className="text-sm text-slate-400 ml-auto font-medium">
                      ${group.reduce((s, q) => s + (q.total || 0), 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.map(quote => (
                      <Link key={quote.id} to={createPageUrl(`QuoteDetails?id=${quote.id}`)}>
                        <Card className={cn("p-4 border-slate-200 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer", color)}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              <div>
                                <span className="font-semibold text-slate-900">{quote.site_id || "â€”"}</span>
                                {quote.quote_number && (
                                  <span className="text-sm text-slate-500 ml-2">{quote.quote_number}</span>
                                )}
                                {quote.case_number && (
                                  <span className="text-xs text-slate-400 ml-2">Case: {quote.case_number}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-slate-500 flex-shrink-0">
                              <span>{format(new Date(quote.created_date), "MMM d, yyyy")}</span>
                              <span className="font-semibold text-slate-800">${(quote.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}

            {searchedQuotes.length === 0 && (
              <Card className="p-12 text-center border-slate-200">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No quotes found</h3>
                <p className="text-slate-600">
                  {search ? "Try adjusting your search" : `No ${isOpen ? "open" : "closed"} quotes yet`}
                </p>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function QuoteOverview() {
  return (
    <RoleGuard>
      <QuoteOverviewContent />
    </RoleGuard>
  );
}