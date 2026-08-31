import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, AlertCircle, RefreshCw, CheckCircle2, Clock, Search } from "lucide-react";
import { format } from "date-fns";

const STATUS_LABEL = {
  draft_without_internal: "Draft",
  draft_without_fst: "Draft (No FST)",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  quote_sent_to_ho: "Sent to HO",
  ho_approved_invoice_required: "HO Approved",
  ho_rejected: "HO Rejected",
  invoiced: "Invoiced",
  invoice_paid: "Invoice Paid",
  scheduled: "Scheduled",
  pending_materials: "Pending Materials",
  on_hold: "On Hold",
};

const STATUS_COLOR = {
  rejected: "bg-red-100 text-red-700",
  ho_rejected: "bg-red-100 text-red-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  quote_sent_to_ho: "bg-purple-100 text-purple-700",
  ho_approved_invoice_required: "bg-emerald-100 text-emerald-700",
  invoiced: "bg-teal-100 text-teal-700",
  invoice_paid: "bg-green-200 text-green-800",
  scheduled: "bg-teal-200 text-teal-800",
  pending_materials: "bg-yellow-100 text-yellow-700",
  on_hold: "bg-slate-100 text-slate-600",
  draft_without_internal: "bg-slate-100 text-slate-500",
  draft_without_fst: "bg-slate-100 text-slate-500",
};

function getTroubleScore(site) {
  return (site.totalRejections * 2) + (site.reworkCount) + (site.hoRejections * 2);
}

function getSiteTroubleLevel(score) {
  if (score >= 6) return { label: "Critical", color: "bg-red-100 text-red-700 border-red-300" };
  if (score >= 3) return { label: "Elevated", color: "bg-orange-100 text-orange-700 border-orange-300" };
  return { label: "Moderate", color: "bg-yellow-100 text-yellow-700 border-yellow-300" };
}

function buildSiteRecord(siteId, quotes) {
  const sorted = [...quotes].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
  const latest = sorted[0];

  // Count total rejections across all quotes for this site
  let totalRejections = 0;
  let hoRejections = 0;
  let reworkCount = 0; // re-submissions after a rejection

  quotes.forEach(q => {
    if (q.status === "rejected") totalRejections++;
    if (q.status === "ho_rejected") hoRejections++;

    // Count rejections in status_history per quote
    const history = q.status_history || [];
    const rejectionEvents = history.filter(h => h.status === "rejected" || h.status === "ho_rejected").length;
    const resubmitEvents = history.filter(h => h.status === "submitted").length;
    // Rework = re-submitted after first rejection
    if (rejectionEvents > 0 && resubmitEvents > 1) reworkCount += resubmitEvents - 1;
    // Also count quote-level rejections (current status) if not already counted via history
    if (rejectionEvents === 0 && (q.status === "rejected" || q.status === "ho_rejected")) totalRejections++;
  });

  // Unique quote versions (parent_quote_id grouping)
  const uniqueParents = new Set(quotes.map(q => q.parent_quote_id || q.id));
  const versionChains = uniqueParents.size;

  const activeQuotes = quotes.filter(q =>
    !["invoice_paid", "invoiced", "scheduled"].includes(q.status)
  );

  // Primary submitter = whoever first submitted the most recent quote
  const latestHistory = latest?.status_history || [];
  const primarySubmitter = latestHistory.find(h => h.status === "submitted")?.changed_by ||
    quotes.flatMap(q => q.status_history || []).find(h => h.status === "submitted")?.changed_by || null;

  return {
    site_id: siteId,
    quotes,
    latest,
    submitter: primarySubmitter,
    totalQuotes: quotes.length,
    totalRejections,
    hoRejections,
    reworkCount,
    versionChains,
    activeQuotes,
    currentStatus: latest?.status,
  };
}

function getQuoteSubmitter(q) {
  const history = q.status_history || [];
  const firstSubmit = history.find(h => h.status === "submitted");
  return firstSubmit?.changed_by || null;
}

function SiteRow({ site }) {
  const [expanded, setExpanded] = useState(false);
  const score = getTroubleScore(site);
  const level = getSiteTroubleLevel(score);

  return (
    <div className={cn("border-2 rounded-xl overflow-hidden", level.color.includes("red") ? "border-red-200" : level.color.includes("orange") ? "border-orange-200" : "border-yellow-200")}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 text-left gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-800">Site {site.site_id}</span>
              {site.submitter && (
                <span className="text-xs text-indigo-600 font-medium bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                  👤 {site.submitter}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
              <span>📋 {site.totalQuotes} quote{site.totalQuotes !== 1 ? "s" : ""}</span>
              {site.totalRejections > 0 && <span className="text-red-600 font-medium">✕ {site.totalRejections} rejection{site.totalRejections !== 1 ? "s" : ""}</span>}
              {site.hoRejections > 0 && <span className="text-red-700 font-medium">✕ {site.hoRejections} HO rejection{site.hoRejections !== 1 ? "s" : ""}</span>}
              {site.reworkCount > 0 && <span className="text-orange-600 font-medium">↺ {site.reworkCount} rework{site.reworkCount !== 1 ? "s" : ""}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-slate-400">
          <span>Score: <strong className="text-slate-700">{score}</strong></span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Quote History</p>
          {site.quotes
            .sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date))
            .map(q => {
              const rejInHistory = (q.status_history || []).filter(h => h.status === "rejected" || h.status === "ho_rejected");
              const resubmits = (q.status_history || []).filter(h => h.status === "submitted");
              return (
                <div key={q.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-slate-700">
                    #{q.quote_number || "—"}
                    {q.version_number > 1 && <span className="ml-1 text-indigo-500">v{q.version_number}</span>}
                    {getQuoteSubmitter(q) && (
                      <span className="ml-2 font-normal text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                        👤 {getQuoteSubmitter(q)}
                      </span>
                    )}
                  </span>
                  <Badge className={cn("text-xs", STATUS_COLOR[q.status] || "bg-slate-100 text-slate-600")}>
                      {STATUS_LABEL[q.status] || q.status}
                    </Badge>
                  </div>
                  {q.total != null && (
                    <p className="text-slate-500">Total: <strong className="text-slate-700">${(q.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></p>
                  )}
                  {rejInHistory.length > 0 && (
                    <div className="space-y-0.5">
                      {rejInHistory.map((h, i) => (
                        <p key={i} className="text-red-600">
                          ✕ Rejected by {h.changed_by || "unknown"} on {h.changed_at ? format(new Date(h.changed_at), "MMM d, yyyy") : "—"}
                          {h.reason && ` — "${h.reason}"`}
                        </p>
                      ))}
                    </div>
                  )}
                  {q.rejection_reason && (
                    <p className="text-red-500 italic">Reason: {q.rejection_reason}</p>
                  )}
                  {resubmits.length > 1 && (
                    <p className="text-orange-600">↺ Resubmitted {resubmits.length - 1} time{resubmits.length > 2 ? "s" : ""}</p>
                  )}
                  <p className="text-slate-400">
                    Last updated: {q.updated_date ? format(new Date(q.updated_date), "MMM d, yyyy") : "—"}
                  </p>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export default function SiteQuoteTracker() {
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(2);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["site-quote-tracker-quotes"],
    queryFn: async () => (await getQuotes()).sort((a, b) => String(b.updated_date || "").localeCompare(String(a.updated_date || ""))).slice(0, 500),
  });

  // Group all quotes by site_id
  const siteMap = {};
  quotes.forEach(q => {
    if (!q.site_id) return;
    if (!siteMap[q.site_id]) siteMap[q.site_id] = [];
    siteMap[q.site_id].push(q);
  });

  // Build site records and filter to only troubled sites
  const siteRecords = Object.entries(siteMap)
    .map(([siteId, qs]) => buildSiteRecord(siteId, qs))
    .filter(s => getTroubleScore(s) >= minScore)
    .sort((a, b) => getTroubleScore(b) - getTroubleScore(a));

  const filtered = siteRecords.filter(s =>
    !search || s.site_id.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>Loading quote history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-xs text-red-500 uppercase tracking-wide">Critical Sites</p>
            <p className="text-2xl font-bold text-red-700">{siteRecords.filter(s => getTroubleScore(s) >= 6).length}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <p className="text-xs text-orange-500 uppercase tracking-wide">Elevated Sites</p>
            <p className="text-2xl font-bold text-orange-700">{siteRecords.filter(s => { const sc = getTroubleScore(s); return sc >= 3 && sc < 6; }).length}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-4">
            <p className="text-xs text-yellow-600 uppercase tracking-wide">Moderate Sites</p>
            <p className="text-2xl font-bold text-yellow-700">{siteRecords.filter(s => { const sc = getTroubleScore(s); return sc >= 2 && sc < 3; }).length}</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-slate-400">
        Trouble score = (rejections × 2) + reworks + (HO rejections × 2). Sites with score ≥ 2 shown.
        Click any site to expand its full quote history.
      </p>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search by Site ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Site List */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <p className="font-semibold text-slate-700">No troubled sites found</p>
          <p className="text-sm text-slate-400 mt-1">Sites with repeated rejections or reworks will appear here.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(site => (
            <SiteRow key={site.site_id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}