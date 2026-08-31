import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { createLocalRecord, deleteLocalRecord, getCurrentUser, listLocalCollection, updateLocalRecord } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Search, ShoppingCart, ExternalLink, Pencil, CheckCircle, Package, Truck, XCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import MaterialOrderForm from "@/components/materials/MaterialOrderForm";
import MaterialStatusBadge from "@/components/materials/MaterialStatusBadge";

const statusFilters = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "ordered", label: "Ordered" },
  { value: "complete", label: "Complete" },
  { value: "rejected", label: "Rejected" }
];

function MaterialOrdersContent() {
  const { isAdmin, user } = useUserRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showAdminActionDialog, setShowAdminActionDialog] = useState(false);
  const [adminAction, setAdminAction] = useState(null); // { order, nextStatus, label }
  const [adminNote, setAdminNote] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["materialOrders"],
    queryFn: async () => {
      return listLocalCollection("materialOrders");
    }
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, data }) =>
      id ? updateLocalRecord("materialOrders", id, data)
        : createLocalRecord("materialOrders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materialOrders"] });
      setShowForm(false);
      setEditingOrder(null);
      toast.success("Order request saved");
    }
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, data }) => updateLocalRecord("materialOrders", id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materialOrders"] });
      setShowAdminActionDialog(false);
      setAdminNote("");
      toast.success("Status updated");
    }
  });

  const handleSave = async (data, mode) => {
    const currentUser = await getCurrentUser();
    const isNew = !editingOrder;
    const baseData = {
      ...data,
      status: data.status || (mode === "submit" ? "submitted" : "draft")
    };

    if (mode === "submit" && (isNew || editingOrder?.status === "draft")) {
      baseData.submitted_date = new Date().toISOString();
      baseData.status_history = [
        ...(editingOrder?.status_history || []),
        { status: "submitted", changed_by: currentUser.email, changed_at: new Date().toISOString() }
      ];
    } else if (mode === "draft") {
      baseData.status_history = editingOrder?.status_history || [];
    }

    saveMutation.mutate({ id: editingOrder?.id, data: baseData });
  };

  const openAdminAction = (order, nextStatus, label) => {
    setAdminAction({ order, nextStatus, label });
    setAdminNote("");
    setShowAdminActionDialog(true);
  };

  const handleAdminAction = async () => {
    const currentUser = await getCurrentUser();
    const { order, nextStatus } = adminAction;
    const now = new Date().toISOString();
    const update = {
      status: nextStatus,
      status_history: [
        ...(order.status_history || []),
        { status: nextStatus, changed_by: currentUser.email, changed_at: now, note: adminNote || null }
      ],
      admin_notes: adminNote || order.admin_notes
    };
    if (nextStatus === "approved") { update.approved_by = currentUser.email; update.approved_date = now; }
    if (nextStatus === "ordered")  { update.ordered_date = now; }
    if (nextStatus === "complete") { update.completed_date = now; }
    statusMutation.mutate({ id: order.id, data: update });
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteLocalRecord("materialOrders", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materialOrders"] });
      setShowDeleteDialog(false);
      setDeletingOrder(null);
      toast.success("Order deleted");
    }
  });

  const filteredOrders = orders.filter(o => {
    const matchSearch =
      o.site_id?.toLowerCase().includes(search.toLowerCase()) ||
      o.item_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.sku?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Custom Material Orders</h1>
            <p className="text-slate-600 mt-1">Request custom materials for site work</p>
          </div>
          <Button
            onClick={() => { setEditingOrder(null); setShowForm(true); }}
            className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Request
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by site ID, item name, or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
              {statusFilters.map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    statusFilter === f.value
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Orders List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Card key={i} className="h-24 animate-pulse bg-slate-100" />)}
          </div>
        ) : filteredOrders.length === 0 ? (
          <Card className="p-12 text-center border-slate-200">
            <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No orders found</h3>
            <p className="text-slate-500">
              {search || statusFilter !== "all" ? "Try adjusting your filters" : "Submit your first material order request"}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(order => (
              <Card key={order.id} className="p-5 border-slate-200 hover:shadow-md transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <MaterialStatusBadge status={order.status} />
                      <span className="text-sm font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                        {order.site_id}
                      </span>
                      <span className="text-xs text-slate-400">
                        {format(new Date(order.created_date), "MMM d, yyyy")}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900">{order.item_name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-500">
                      {order.sku && <span>SKU: <span className="text-slate-700 font-medium">{order.sku}</span></span>}
                      {order.quantity && <span>Qty: <span className="text-slate-700 font-medium">{order.quantity}</span></span>}
                      {order.cost && <span>Est. Cost: <span className="text-emerald-700 font-semibold">${order.cost.toFixed(2)}</span></span>}
                    </div>
                    {order.shipping_address && (
                      <div className="flex items-start gap-1 mt-2 text-sm text-slate-600">
                        <span className="font-medium text-slate-500 shrink-0">Ship to:</span>
                        <span className="whitespace-pre-line">{order.shipping_address}</span>
                      </div>
                    )}
                    {order.notes && <p className="text-sm text-slate-500 mt-2 line-clamp-2">{order.notes}</p>}
                    {order.admin_notes && (
                      <div className="mt-2 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1">
                        <span className="font-medium">Admin note:</span> {order.admin_notes}
                      </div>
                    )}
                    {order.item_link && (
                      <a
                        href={order.item_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" /> View Item Link
                      </a>
                    )}
                    <p className="text-xs text-slate-400 mt-2">Submitted by: {order.created_by}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {/* Edit - only on draft by creator or admin */}
                    {(order.status === "draft") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingOrder(order); setShowForm(true); }}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                    )}
                    {/* Submit - only on draft by creator */}
                    {order.status === "draft" && (
                      <Button
                        size="sm"
                        className="bg-indigo-600 hover:bg-indigo-700"
                        onClick={async () => {
                          const currentUser = await getCurrentUser();
                          const now = new Date().toISOString();
                          statusMutation.mutate({ id: order.id, data: {
                            status: "submitted",
                            submitted_date: now,
                            status_history: [...(order.status_history || []), { status: "submitted", changed_by: currentUser.email, changed_at: now }]
                          }});
                        }}
                      >
                        <Package className="w-3.5 h-3.5 mr-1" /> Submit
                      </Button>
                    )}
                    {/* Admin actions */}
                    {isAdmin && order.status === "submitted" && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => openAdminAction(order, "approved", "Approve")}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                      </Button>
                    )}
                    {isAdmin && order.status === "approved" && (
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700"
                        onClick={() => openAdminAction(order, "ordered", "Mark as Ordered")}
                      >
                        <Truck className="w-3.5 h-3.5 mr-1" /> Mark Ordered
                      </Button>
                    )}
                    {isAdmin && order.status === "ordered" && (
                      <Button
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700"
                        onClick={() => openAdminAction(order, "complete", "Mark Complete")}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Mark Complete
                      </Button>
                    )}
                    {isAdmin && !["complete"].includes(order.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-300 text-rose-600 hover:bg-rose-50"
                        onClick={() => openAdminAction(order, "rejected", "Reject Order")}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-300 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                        onClick={() => { setDeletingOrder(order); setShowDeleteDialog(true); }}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <MaterialOrderForm
            order={editingOrder}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingOrder(null); }}
            isLoading={saveMutation.isPending}
          />
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong>{deletingOrder?.item_name}</strong> (Site: {deletingOrder?.site_id})? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(deletingOrder?.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Action Dialog */}
      <Dialog open={showAdminActionDialog} onOpenChange={setShowAdminActionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{adminAction?.label}</DialogTitle>
            <DialogDescription>
              {adminAction?.order?.item_name} — Site: {adminAction?.order?.site_id}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Note (optional)</Label>
            <Textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="Add a note about this action..."
              rows={3}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdminActionDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAdminAction}
              disabled={statusMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MaterialOrders() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <MaterialOrdersContent />
    </RoleGuard>
  );
}