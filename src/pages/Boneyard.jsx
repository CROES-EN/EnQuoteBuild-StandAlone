import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getCurrentUser, getQuotes, updateQuote } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link, useLocation} from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Search, ArchiveRestore, Archive, Calendar, DollarSign, User, MessageSquare } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import StatusBadge from "@/components/quotes/StatusBadge";

function BoneyardContent() {
  const { isAdmin, user } = useUserRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreNote, setRestoreNote] = useState("");

  const { data: onHoldQuotes = [], isLoading } = useQuery({
    queryKey: ["boneyard-quotes"],
    queryFn: async () => {
    const all = await getQuotes();
      return all.filter(q => q.status === "on_hold" && q.is_current_version !== false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateQuote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["boneyard-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    }
  });

  const handleRestore = async () => {
    const currentUser = await getCurrentUser();
    const now = new Date().toISOString();
    const restoredStatus = restoreTarget.pre_hold_status || "quote_sent_to_ho";

    await updateMutation.mutateAsync({
      id: restoreTarget.id,
      data: {
        status: restoredStatus,
        exclude_from_reporting: false,
        pre_hold_status: null,
        hold_reason: null,
        hold_date: null,
        status_history: [
          ...(restoreTarget.status_history || []),
          {
            entry_type: "status_change",
            status: restoredStatus,
            changed_by: currentUser.email,
            changed_at: now,
            reason: restoreNote.trim() || "Restored from Boneyard â€” HO decision received"
          }
        ]
      }
    });

    toast.success(`Quote restored to "${restoredStatus.replace(/_/g, " ")}" and re-included in reporting`);
    setRestoreTarget(null);
    setRestoreNote("");
  };

  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const start = params.get("start");
  const end = params.get("end");
  const dateFiltered = onHoldQuotes.filter((quote) => !start || !end || (quote.hold_date || quote.updated_date || quote.created_date)?.slice(0, 10) >= start && (quote.hold_date || quote.updated_date || quote.created_date)?.slice(0, 10) <= end);
  const filtered = dateFiltered.filter(q =>
    q.site_id?.toLowerCase().includes(search.toLowerCase()) ||
    q.case_number?.toLowerCase().includes(search.toLowerCase()) ||
    q.quote_number?.toLowerCase().includes(search.toLowerCase()) ||
    q.created_by?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <Archive className="w-5 h-5 text-amber-700" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900">Boneyard</h1>
            </div>
            <p className="text-slate-500 ml-13">Quotes on hold pending homeowner decision â€” excluded from SLA &amp; revenue reporting</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-amber-700">{dateFiltered.length}</p>
            <p className="text-sm text-slate-500">quotes on hold</p>
          </div>
        </div>

        {/* Info Banner */}
        <Card className="p-4 mb-6 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <Archive className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800">About the Boneyard</p>
              <p className="text-sm text-amber-700 mt-0.5">
                These quotes are awaiting long-term homeowner decisions and are <strong>excluded from all SLA and revenue numbers</strong>.
                When an HO is ready to proceed, restore the quote to production and it will re-enter reporting immediately.
              </p>
            </div>
          </div>
        </Card>

        {/* Search */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by Site ID, Case Number, Quote #, or Agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </Card>

        {/* Quotes List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Card key={i} className="h-28 animate-pulse bg-slate-100" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center border-slate-200">
            <Archive className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {search ? "No matching quotes" : "Boneyard is empty"}
            </h3>
            <p className="text-slate-500">
              {search ? "Try adjusting your search" : "No quotes are currently on hold"}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(quote => (
              <Card key={quote.id} className="p-5 border-amber-100 hover:border-amber-300 transition-colors bg-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <Link
                        to={createPageUrl(`QuoteDetails?id=${quote.id}`)}
                        className="text-lg font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
                      >
                        {quote.site_id || "No Site ID"}
                      </Link>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        <Archive className="w-3 h-3" /> On Hold
                      </span>
                      {quote.pre_hold_status && (
                        <span className="text-xs text-slate-400">
                          was: <StatusBadge status={quote.pre_hold_status} size="small" />
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                      {quote.case_number && (
                        <span>Case: <span className="font-medium text-slate-700">{quote.case_number}</span></span>
                      )}
                      {quote.quote_number && (
                        <span>Quote #: <span className="font-medium text-slate-700">{quote.quote_number}</span></span>
                      )}
                      {quote.total != null && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          <span className="font-medium text-slate-700">${quote.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </span>
                      )}
                      {quote.created_by && (
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          <span>{quote.created_by}</span>
                        </span>
                      )}
                    </div>
                    {quote.hold_reason && (
                      <div className="flex items-start gap-1.5 mt-2">
                        <MessageSquare className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-amber-700 italic">{quote.hold_reason}</p>
                      </div>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-slate-400">
                      {quote.hold_date && (
                        <span>Held {formatDistanceToNow(new Date(quote.hold_date), { addSuffix: true })}</span>
                      )}
                      {quote.last_follow_up_date && (
                        <span>Last follow-up: {format(new Date(quote.last_follow_up_date), "MMM d, yyyy")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link to={createPageUrl(`QuoteDetails?id=${quote.id}`)}>
                      <Button variant="outline" size="sm" className="border-slate-200 text-slate-600">
                        View
                      </Button>
                    </Link>
                    {(isAdmin || user?.email === quote.created_by) && (
                      <Button
                        size="sm"
                        onClick={() => { setRestoreTarget(quote); setRestoreNote(""); }}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        <ArchiveRestore className="w-4 h-4 mr-1.5" />
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Restore Dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Quote from Boneyard</DialogTitle>
            <DialogDescription>
              This will move <strong>{restoreTarget?.site_id}</strong> back into active production
              {restoreTarget?.pre_hold_status && (
                <> with status <strong>"{restoreTarget.pre_hold_status.replace(/_/g, " ")}"</strong></>
              )}, and re-include it in SLA &amp; revenue reporting.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={restoreNote}
            onChange={(e) => setRestoreNote(e.target.value)}
            placeholder="Optional note (e.g. 'HO confirmed approval on 5/12 â€” proceeding with invoice')"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button
              onClick={handleRestore}
              disabled={updateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <ArchiveRestore className="w-4 h-4 mr-2" />
              Restore to Production
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Boneyard() {
  return (
    <RoleGuard>
      <BoneyardContent />
    </RoleGuard>
  );
}