import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Trash2, CheckCircle, XCircle, Clock, Archive, ArchiveRestore, Eye } from "lucide-react";
import { toast } from "sonner";
import { getQuoteById, getQuotes, listLocalCollection, updateLocalRecord, updateQuote } from "@/api/dataClient";
import RoleGuard from "@/components/auth/RoleGuard";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

function QuoteDeletionRequestsContent() {
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["deletionRequests"],
    queryFn: async () => {
      return listLocalCollection("deletionRequests");
    }
  });

  const updateRequestMutation = useMutation({
    mutationFn: ({ id, data }) => updateLocalRecord("deletionRequests", id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deletionRequests"] });
    }
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["deletionRequestQuotes"],
    queryFn: async () => {
      return getQuotes();
    }
  });

  const archiveQuoteMutation = useMutation({
    mutationFn: async ({ request, user }) => {
      const quote = await getQuoteById(request.quote_id);
      const now = new Date().toISOString();
      return updateQuote(request.quote_id, {
        status: "on_hold",
        exclude_from_reporting: true,
        pre_hold_status: quote.status,
        hold_reason: "Archived through an approved deletion request",
        hold_date: now,
        status_history: [
          ...(quote.status_history || []),
          {
            entry_type: "status_change",
            status: "on_hold",
            changed_by: user.email,
            changed_at: now,
            reason: "Archived through an approved deletion request"
          }
        ]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["deletionRequestQuotes"] });
    }
  });

  const restoreQuoteMutation = useMutation({
    mutationFn: async ({ request, quote, user }) => {
      const now = new Date().toISOString();
      return updateQuote(request.quote_id, {
        status: quote.pre_hold_status || "draft_without_internal",
        exclude_from_reporting: false,
        pre_hold_status: null,
        hold_reason: null,
        hold_date: null,
        status_history: [
          ...(quote.status_history || []),
          {
            entry_type: "status_change",
            status: quote.pre_hold_status || "draft_without_internal",
            changed_by: user.email,
            changed_at: now,
            reason: "Reactivated from archived deletion request"
          }
        ]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["deletionRequestQuotes"] });
    }
  });

  const handleApprove = async () => {
    const user = await base44.auth.me();
    await archiveQuoteMutation.mutateAsync({ request: selectedRequest, user });

    await updateRequestMutation.mutateAsync({
      id: selectedRequest.id,
      data: {
        status: "approved",
        reviewed_by: user.email,
        reviewed_date: new Date().toISOString(),
        admin_notes: adminNotes
      }
    });
    
    setShowApproveDialog(false);
    setSelectedRequest(null);
    setAdminNotes("");
    toast.success("Quote archived and request approved");
  };

  const handleReactivate = async (request, quote) => {
    const user = await base44.auth.me();
    await restoreQuoteMutation.mutateAsync({ request, quote, user });
    toast.success("Quote reactivated");
  };

  const handleReject = async () => {
    const user = await base44.auth.me();
    
    await updateRequestMutation.mutateAsync({
      id: selectedRequest.id,
      data: {
        status: "rejected",
        reviewed_by: user.email,
        reviewed_date: new Date().toISOString(),
        admin_notes: adminNotes
      }
    });
    
    setShowRejectDialog(false);
    setSelectedRequest(null);
    setAdminNotes("");
    toast.success("Deletion request rejected");
  };

  const pendingRequests = requests.filter(r => r.status === "pending");
  const reviewedRequests = requests.filter(r => r.status !== "pending");
  const quoteById = Object.fromEntries(quotes.map((quote) => [quote.id, quote]));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Quote Deletion Requests</h1>
          <p className="text-slate-600 mt-1">Review deletion requests, archive quotes, and reactivate them when needed</p>
        </div>

        {/* Pending Requests */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            Pending Requests ({pendingRequests.length})
          </h2>
          {pendingRequests.length === 0 ? (
            <Card className="p-8 text-center border-slate-200">
              <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">No pending deletion requests</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((request) => (
                <Card key={request.id} className="p-6 border-slate-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-slate-900">
                          {request.quote_number}
                        </h3>
                        <Badge className="bg-amber-100 text-amber-700">Pending</Badge>
                      </div>
                      <div className="space-y-1 text-sm text-slate-600">
                        <p><span className="font-medium">Requested by:</span> {request.requested_by}</p>
                        <p><span className="font-medium">Date:</span> {format(new Date(request.created_date), "MMM d, yyyy 'at' h:mm a")}</p>
                        <p className="mt-2"><span className="font-medium">Reason:</span></p>
                        <p className="text-slate-700 bg-slate-50 p-3 rounded-lg">{request.reason}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Link to={createPageUrl(`QuoteDetails?id=${request.quote_id}`)}>
                        <Button variant="outline" size="sm">
                          View Quote
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedRequest(request);
                          setShowRejectDialog(true);
                        }}
                        className="border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedRequest(request);
                          setShowApproveDialog(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        <Archive className="w-4 h-4 mr-1" />
                        Approve & Archive
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Reviewed Requests */}
        {reviewedRequests.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold text-slate-900 mb-4">
              Reviewed Requests ({reviewedRequests.length})
            </h2>
            <div className="space-y-4">
              {reviewedRequests.map((request) => {
                const quote = quoteById[request.quote_id];
                const isArchived = request.status === "approved" && quote?.status === "on_hold" && quote.hold_reason === "Archived through an approved deletion request";
                const isReactivated = request.status === "approved" && quote && !isArchived;
                const requestLabel = isArchived ? "Archived" : isReactivated ? "Reactivated" : request.status === "approved" ? "Deleted" : "Rejected";

                return (
                  <Card key={request.id} className="p-6 border-slate-200">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-slate-900">{request.quote_number}</h3>
                          <Badge className={request.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                            {requestLabel}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-sm text-slate-600">
                          <p><span className="font-medium">Requested by:</span> {request.requested_by}</p>
                          <p><span className="font-medium">Reviewed by:</span> {request.reviewed_by}</p>
                          <p><span className="font-medium">Reviewed on:</span> {format(new Date(request.reviewed_date), "MMM d, yyyy 'at' h:mm a")}</p>
                          <p className="mt-2"><span className="font-medium">Request Reason:</span></p>
                          <p className="text-slate-700 bg-slate-50 p-3 rounded-lg">{request.reason}</p>
                          {request.admin_notes && (
                            <>
                              <p className="mt-2"><span className="font-medium">Admin Notes:</span></p>
                              <p className="text-slate-700 bg-slate-50 p-3 rounded-lg">{request.admin_notes}</p>
                            </>
                          )}
                        </div>
                      </div>
                      {request.status === "approved" && (
                        <div className="flex flex-wrap gap-2 justify-end">
                          {quote ? (
                            <Link to={createPageUrl(`QuoteDetails?id=${request.quote_id}`)}>
                              <Button variant="outline" size="sm">
                                <Eye className="w-4 h-4 mr-1" />
                                View Quote
                              </Button>
                            </Link>
                          ) : (
                            <span className="text-xs text-slate-500">Permanently deleted</span>
                          )}
                          {isArchived && (
                            <Button
                              size="sm"
                              onClick={() => handleReactivate(request, quote)}
                              disabled={restoreQuoteMutation.isPending}
                              className="bg-emerald-600 hover:bg-emerald-700"
                            >
                              <ArchiveRestore className="w-4 h-4 mr-1" />
                              Reactivate
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Deletion Request & Archive Quote</DialogTitle>
            <DialogDescription>
              This will archive the quote and remove it from reporting. It can be viewed and reactivated later from this page.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Optional: Add notes about your decision..."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={updateRequestMutation.isPending || archiveQuoteMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Archive className="w-4 h-4 mr-2" />
              Approve & Archive Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Deletion Request</DialogTitle>
            <DialogDescription>
              This will reject the deletion request and keep the quote intact.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Optional: Add notes explaining why the request was rejected..."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              disabled={updateRequestMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function QuoteDeletionRequests() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <QuoteDeletionRequestsContent />
    </RoleGuard>
  );
}