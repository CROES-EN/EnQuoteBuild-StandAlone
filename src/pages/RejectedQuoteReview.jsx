import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createReview, getCurrentUser, getQuotes, getReviews, getUsers, updateReview } from "@/api/dataClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Search, CheckCircle2, Clock, FileText, BarChart2, Brain, Layers, ArrowUpDown, EyeOff, ShieldCheck, CheckSquare, Square, X, Loader2 } from "lucide-react";
import QuoteReviewPanel from "@/components/quotes/QuoteReviewPanel";
import RejectionOverview from "@/components/rejection/RejectionOverview";
import RejectionInterpretations from "@/components/rejection/RejectionInterpretations";
import SiteRejectionProgressPanel from "@/components/rejection/SiteRejectionProgressPanel";

const ALLOWED_REVIEWERS = ["smosley", "tmeyer", "dankenman", "tjm8189", "vseganos"];

const isRejectedByAjennings = (quote) => {
  if (quote.status !== "rejected") return false;
  if (!quote.status_history?.length) return false;
  const rejectionEntry = [...quote.status_history]
    .reverse()
    .find(h => h.status === "rejected");
  return rejectionEntry?.changed_by?.toLowerCase().includes("ajennings");
};

const formatDate = (d) => d ? new Date(d).toLocaleDateString() : "—";
const formatCurrency = (v) => `$${(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export default function RejectedQuoteReview() {
  const [currentUser, setCurrentUser] = useState(null);
  const [canReview, setCanReview] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all"); // all | pending | in_progress | completed
  const [hideCompleted, setHideCompleted] = useState(true);
  const [sortOrder, setSortOrder] = useState("newest"); // newest | oldest
  const [selectedSiteIds, setSelectedSiteIds] = useState(new Set());
  const [bulkClosing, setBulkClosing] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then(user => {
      setCurrentUser(user);
      const emailPrefix = user?.email?.split("@")[0]?.toLowerCase() || "";
      setCanReview(ALLOWED_REVIEWERS.some(r => emailPrefix.includes(r)));
    }).catch(() => {});
  }, []);

  const { data: allQuotes = [], isLoading } = useQuery({
    queryKey: ["all-quotes-overview"],
    queryFn: async () => {
      return getQuotes();
    }
  });

  // Quotes currently sitting at rejected status AND were rejected by ajennings
  const quotes = allQuotes.filter(q => q.status === "rejected").filter(isRejectedByAjennings);

  // Resolved statuses — quote was fixed and progressed past rejection
  const RESOLVED_STATUSES = ["approved", "quote_sent_to_ho", "ho_approved_invoice_required", "ho_rejected", "invoiced", "invoice_paid", "scheduled"];

  // For a given site_id, check if any quote has progressed past rejection OR if a newer version exists that is no longer rejected
  const resolvedSiteIds = useMemo(() => {
    const resolved = new Set();
    // Group all quotes by site_id
    const bySite = {};
    allQuotes.forEach(q => {
      if (!bySite[q.site_id]) bySite[q.site_id] = [];
      bySite[q.site_id].push(q);
    });
    Object.entries(bySite).forEach(([siteId, siteVersions]) => {
      // Resolved if any version has a success status
      if (siteVersions.some(q => RESOLVED_STATUSES.includes(q.status))) {
        resolved.add(siteId);
        return;
      }
      // Also resolved if the latest version (by version_number/created_date) is NOT rejected
      // (meaning they've already started a new version to address the rejection)
      const sortedVersions = [...siteVersions].sort((a, b) => {
        const va = a.version_number || 0;
        const vb = b.version_number || 0;
        if (va !== vb) return vb - va;
        return new Date(b.created_date) - new Date(a.created_date);
      });
      const latestNonHold = sortedVersions.find(q => q.status !== "on_hold");
      if (latestNonHold && latestNonHold.status !== "rejected") {
        resolved.add(siteId);
      }
    });
    return resolved;
  }, [allQuotes]);

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users-overview"],
    queryFn: getUsers,
  });

  const { data: allReviews = [] } = useQuery({
    queryKey: ["quote-reviews-all"],
    queryFn: getReviews,
  });

  const getReviewStatus = (quoteId, siteId) => {
    // If the site has already been resolved (a later version was approved/paid), mark as auto-resolved
    if (resolvedSiteIds.has(siteId)) return "resolved";
    const reviews = allReviews.filter(r => r.quote_id === quoteId);
    if (!reviews.length) return "pending";
    if (reviews.some(r => r.review_status === "completed")) return "completed";
    return "in_progress";
  };

  const searchFiltered = quotes.filter(q =>
    !search ||
    q.quote_number?.toLowerCase().includes(search.toLowerCase()) ||
    q.site_id?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    resolved: "bg-slate-100 text-slate-500",
  };

  const statusIcon = {
    pending: <Clock className="w-3 h-3 mr-1" />,
    in_progress: <FileText className="w-3 h-3 mr-1" />,
    completed: <CheckCircle2 className="w-3 h-3 mr-1" />,
    resolved: <ShieldCheck className="w-3 h-3 mr-1" />,
  };

  const toggleSelectSite = (siteId) => {
    setSelectedSiteIds(prev => {
      const next = new Set(prev);
      next.has(siteId) ? next.delete(siteId) : next.add(siteId);
      return next;
    });
  };

  const handleBulkClose = async () => {
    if (!selectedSiteIds.size) return;
    setBulkClosing(true);
    const now = new Date().toISOString();
    const note = `Bulk closed by ${currentUser?.email} on ${new Date().toLocaleDateString()} — quote was reviewed, feedback provided, and a corrected version was approved for HO review.`;

    // For each selected site, close all pending/in_progress reviews; create one if none exists
    await Promise.allSettled([...selectedSiteIds].map(async (siteId) => {
      // Find all rejected quotes for this site that need a completed review
      const siteRejectedQuotes = allQuotes.filter(q => q.site_id === siteId && q.status === "rejected");
      await Promise.allSettled(siteRejectedQuotes.map(async (q) => {
        const existing = allReviews.filter(r => r.quote_id === q.id);
        const incomplete = existing.filter(r => r.review_status !== "completed");
        if (incomplete.length > 0) {
          await Promise.allSettled(incomplete.map(r =>
            updateReview(r.id, { review_status: "completed", coaching_notes: r.coaching_notes || note, completed_date: now })
          ));
        } else if (existing.length === 0) {
          await createReview({
            quote_id: q.id,
            quote_number: q.quote_number,
            site_id: q.site_id,
            reviewer_email: currentUser?.email,
            rejection_reason_snapshot: q.rejection_reason,
            coaching_notes: note,
            recommended_edits: "Manually bulk-closed — corrected version approved for HO.",
            review_status: "completed",
            completed_date: now,
          });
        }
      }));
    }));

    setSelectedSiteIds(new Set());
    setBulkClosing(false);
    queryClient.invalidateQueries({ queryKey: ["quote-reviews-all"] });
  };

  if (!canReview && currentUser) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
        <AlertCircle className="w-12 h-12 text-orange-400" />
        <h2 className="text-xl font-semibold text-slate-700">Access Restricted</h2>
        <p className="text-slate-500 max-w-md">
          This review section is only accessible to authorized reviewers (tmeyer, dankenman).
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Rejected Quote Reviews</h1>
        <p className="text-slate-500 mt-1">
          Quotes rejected by ajennings — review, provide coaching, and recommend edits for resubmission.
        </p>
      </div>

      <Tabs defaultValue="reviews">
        <TabsList className="mb-6">
          <TabsTrigger value="reviews" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Quote Reviews
          </TabsTrigger>
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4" /> Rejection Overview
          </TabsTrigger>
          <TabsTrigger value="interpretations" className="flex items-center gap-2">
            <Brain className="w-4 h-4" /> AI Interpretations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <RejectionOverview allQuotes={allQuotes} users={allUsers} />
        </TabsContent>

        <TabsContent value="interpretations">
          <RejectionInterpretations allQuotes={allQuotes} allReviews={allReviews} users={allUsers} />
        </TabsContent>

        <TabsContent value="reviews">
      {/* Stats Bar — clickable filters */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        {["pending", "in_progress", "completed", "resolved"].map(s => {
          const count = quotes.filter(q => getReviewStatus(q.id, q.site_id) === s).length;
          const isActive = statusFilter === s;
          return (
            <Card
              key={s}
              className={`border-slate-200 cursor-pointer transition-all hover:shadow-md ${isActive ? "ring-2 ring-orange-400 border-orange-300" : ""}`}
              onClick={() => setStatusFilter(isActive ? "all" : s)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <Badge className={`${statusColors[s]} text-xs`}>
                  {statusIcon[s]} {s.replace("_", " ")}
                </Badge>
                <span className="text-2xl font-bold text-slate-800">{count}</span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search + Sort + Filter Controls */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by quote number or site ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1.5 shrink-0"
          onClick={() => setSortOrder(o => o === "newest" ? "oldest" : "newest")}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortOrder === "newest" ? "Newest First" : "Oldest First"}
        </Button>
        <Button
          variant={hideCompleted ? "default" : "outline"}
          size="sm"
          className={`flex items-center gap-1.5 shrink-0 ${hideCompleted ? "bg-slate-700 text-white hover:bg-slate-800" : ""}`}
          onClick={() => setHideCompleted(h => !h)}
        >
          <EyeOff className="w-3.5 h-3.5" />
          {hideCompleted ? "Showing Active Only" : "Hide Completed & Resolved"}
        </Button>
      </div>

      {/* Bulk Action Bar */}
      {selectedSiteIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
          <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-sm font-medium text-indigo-800 flex-1">{selectedSiteIds.size} site{selectedSiteIds.size > 1 ? "s" : ""} selected</span>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={handleBulkClose}
            disabled={bulkClosing}
          >
            {bulkClosing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            {bulkClosing ? "Closing..." : "Mark All Complete"}
          </Button>
          <Button size="sm" variant="ghost" className="text-slate-500 px-2" onClick={() => setSelectedSiteIds(new Set())}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Quote List — grouped by site */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading rejected quotes...</div>
      ) : searchFiltered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-300" />
          No rejected quotes from ajennings found.
        </div>
      ) : (() => {
          // Group by site_id
          const bySite = {};
          searchFiltered.forEach(q => {
            const sid = q.site_id || "unknown";
            if (!bySite[sid]) bySite[sid] = [];
            bySite[sid].push(q);
          });

          // Build site entries, then apply filters + sort
          let siteEntries = Object.entries(bySite).map(([siteId, siteQuotes]) => {
            // Pick the most recently rejected quote as the representative for this site
            const latest = [...siteQuotes].sort((a, b) => {
              const aRej = [...(a.status_history || [])].reverse().find(h => h.status === "rejected");
              const bRej = [...(b.status_history || [])].reverse().find(h => h.status === "rejected");
              return new Date(bRej?.changed_at || b.updated_date) - new Date(aRej?.changed_at || a.updated_date);
            })[0];
            const reviewStatus = getReviewStatus(latest.id, siteId);
            const reviewCount = siteQuotes.reduce((acc, q) => acc + allReviews.filter(r => r.quote_id === q.id).length, 0);
            const totalRejections = siteQuotes.reduce((acc, q) =>
              acc + (q.status_history || []).filter(h => h.status === "rejected").length, 0);
            const lastUpdated = new Date(latest.updated_date);
            return { siteId, siteQuotes, latest, reviewStatus, reviewCount, totalRejections, lastUpdated };
          });

          // Apply status filter
          if (statusFilter !== "all") {
            siteEntries = siteEntries.filter(e => e.reviewStatus === statusFilter);
          }
          // Apply hide completed/resolved
          if (hideCompleted) {
            siteEntries = siteEntries.filter(e => e.reviewStatus !== "completed" && e.reviewStatus !== "resolved");
          }
          // Apply sort
          siteEntries.sort((a, b) => sortOrder === "newest"
            ? b.lastUpdated - a.lastUpdated
            : a.lastUpdated - b.lastUpdated
          );

          if (siteEntries.length === 0) {
            return (
              <div className="text-center py-12 text-slate-400">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-300" />
                No quotes match the selected filters.
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {siteEntries.map(({ siteId, siteQuotes, latest, reviewStatus, reviewCount, totalRejections }) => {
                const hasMultiple = siteQuotes.length > 1;
                const rejectionEntry = [...(latest.status_history || [])].reverse().find(h => h.status === "rejected");

                return (
                  <Card
                    key={siteId}
                    className={`transition-all ${
                      reviewStatus === "resolved"
                        ? "border-slate-200 bg-slate-50 opacity-60"
                        : selectedSiteIds.has(siteId)
                          ? "border-indigo-400 bg-indigo-50/30 shadow-sm"
                          : hasMultiple || totalRejections > 1
                            ? "hover:shadow-md border-orange-300 bg-orange-50/30"
                            : "hover:shadow-md border-slate-200"
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          {(reviewStatus === "pending" || reviewStatus === "in_progress") && (
                            <button
                              className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                              onClick={(e) => { e.stopPropagation(); toggleSelectSite(siteId); }}
                            >
                              {selectedSiteIds.has(siteId)
                                ? <CheckSquare className="w-5 h-5 text-indigo-600" />
                                : <Square className="w-5 h-5" />}
                            </button>
                          )}
                          {hasMultiple || totalRejections > 1 ? (
                            <Layers className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-800">Site: {siteId}</p>
                              {(hasMultiple || totalRejections > 1) && (
                                <Badge className="bg-orange-100 text-orange-700 text-xs border border-orange-200">
                                  {totalRejections} rejections · {siteQuotes.length} version{siteQuotes.length > 1 ? "s" : ""}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-slate-500 mt-0.5">
                              Quote#{siteQuotes.map(q => q.quote_number).filter(Boolean).join(", #") || "—"} · Last rejected {formatDate(rejectionEntry?.changed_at)}
                            </p>
                            {reviewStatus === "resolved" && (
                              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> A later version of this quote has been approved or paid — no review needed.
                              </p>
                            )}
                            {reviewStatus !== "resolved" && latest.rejection_reason && (
                              <p className="text-xs text-red-600 mt-0.5 truncate max-w-md">
                                {latest.rejection_reason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          <span className="text-sm font-medium text-slate-700">{formatCurrency(latest.total)}</span>
                          {reviewCount > 0 && (
                            <span className="text-xs text-slate-400">{reviewCount} review{reviewCount > 1 ? "s" : ""}</span>
                          )}
                          <Badge className={`${statusColors[reviewStatus]} text-xs`}>
                            {statusIcon[reviewStatus]} {reviewStatus.replace("_", " ")}
                          </Badge>
                          {(hasMultiple || totalRejections > 1) ? (
                            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={(e) => { e.stopPropagation(); setSelectedSite(siteId); }}>
                              View Progress
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedQuote(latest); }}>
                                Review
                              </Button>
                              <Button size="sm" variant="ghost" className="text-slate-500 text-xs px-2" onClick={(e) => { e.stopPropagation(); setSelectedSite(siteId); }}>
                                History
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          );
        })()
      }


      {/* Single Quote Review Sheet */}
      <Sheet open={!!selectedQuote} onOpenChange={open => !open && setSelectedQuote(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Quote Review</SheetTitle>
          </SheetHeader>
          {selectedQuote && (
            <QuoteReviewPanel
              quote={selectedQuote}
              currentUser={currentUser}
              onClose={() => setSelectedQuote(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Site Progress Panel Sheet */}
      <Sheet open={!!selectedSite} onOpenChange={open => !open && setSelectedSite(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-orange-500" /> Rejection Progress — Site {selectedSite}
            </SheetTitle>
          </SheetHeader>
          {selectedSite && (
            <SiteRejectionProgressPanel
              siteId={selectedSite}
              allReviews={allReviews}
              onReviewQuote={(quote) => { setSelectedSite(null); setSelectedQuote(quote); }}
            />
          )}
        </SheetContent>
      </Sheet>
        </TabsContent>
      </Tabs>
    </div>
  );
}