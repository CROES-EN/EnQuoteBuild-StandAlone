import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { createLocalRecord, getCurrentUser, getUsers, listLocalCollection, updateLocalRecord } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Download, LayoutDashboard, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import RMAForm from "@/components/rma/RMAForm";
import RMADashboard from "@/components/rma/RMADashboard";
import RMAList from "@/components/rma/RMAList";
import { getDaysOpen, getDaysInCurrentStatus } from "@/components/rma/rmaUtils";

const QUICK_FILTERS = [
  { value: "all", label: "All RMAs" },
  { value: "my_cases", label: "My Cases" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "waiting_customer", label: "Waiting for Customer" },
  { value: "mfr_reviewing", label: "Manufacturer Reviewing" },
  { value: "replacement_pending", label: "Replacement Pending" },
  { value: "over_30_days", label: "Over 30 Days Open" },
  { value: "over_14_days_status", label: "Over 14 Days in Status" }
];

function PVPanelRMAsContent() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useUserRole();
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [editingRma, setEditingRma] = useState(null);

  const { data: rmas = [], isLoading } = useQuery({
    queryKey: ["pvPanelRMAs"],
    queryFn: async () => {
      return listLocalCollection("rmas");
    }
  });

  const { data: users = [] } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      return getUsers();
    }
  });

  const { data: manufacturers = [] } = useQuery({
    queryKey: ["pvManufacturers"],
    queryFn: () => listLocalCollection("pvManufacturers"),
  });

  const filteredRmas = useMemo(() => {
    return rmas.filter(rma => {
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        rma.site_id?.toLowerCase().includes(q) ||
        rma.case_id?.toLowerCase().includes(q) ||
        rma.case_owner?.toLowerCase().includes(q) ||
        rma.panel_manufacturer?.toLowerCase().includes(q);
      if (!matchesSearch) return false;
      switch (quickFilter) {
        case "my_cases": return rma.case_owner === currentUser?.email;
        case "open": return rma.current_status !== "Closed";
        case "closed": return rma.current_status === "Closed";
        case "waiting_customer": return rma.current_status === "Waiting for Customer";
        case "mfr_reviewing": return rma.current_status === "Manufacturer Reviewing";
        case "replacement_pending": return rma.current_status === "Replacement Pending Shipment";
        case "over_30_days": return getDaysOpen(rma) > 30;
        case "over_14_days_status": return getDaysInCurrentStatus(rma) > 14;
        default: return true;
      }
    });
  }, [rmas, search, quickFilter, currentUser]);

  const saveMutation = useMutation({
    mutationFn: async ({ formData, existingRma }) => {
      const mfrExists = manufacturers.some(m => m.name === formData.panel_manufacturer);
      if (formData.panel_manufacturer && !mfrExists) {
        await createLocalRecord("pvManufacturers", { name: formData.panel_manufacturer });
      }

      let statusHistory = existingRma?.status_history || [];
      const oldStatus = existingRma?.current_status;
      if (formData.current_status !== oldStatus) {
        const user = await getCurrentUser();
        statusHistory = [...statusHistory, {
          previous_status: oldStatus || null,
          new_status: formData.current_status,
          changed_by: user.email,
          changed_at: new Date().toISOString()
        }];
      }

      const data = { ...formData, status_history: statusHistory };
      if (existingRma) {
        return updateLocalRecord("rmas", existingRma.id, data);
      }
      return createLocalRecord("rmas", data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pvPanelRMAs"] });
      queryClient.invalidateQueries({ queryKey: ["pvManufacturers"] });
      setShowForm(false);
      setEditingRma(null);
      toast.success(variables.existingRma ? "RMA updated successfully" : "RMA created successfully");
    },
    onError: (error) => toast.error(error.message || "Failed to save RMA")
  });

  const handleEdit = (rma) => {
    setEditingRma(rma);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingRma(null);
    setShowForm(true);
  };

  const handleExport = (useFiltered) => {
    const data = useFiltered ? filteredRmas : rmas;
    const headers = [
      "Case Owner", "Site ID", "Case ID", "Panel Manufacturer",
      "Current Status", "Days in Current Status", "Days Open",
      "Last Updated", "RMA URL", "Notes"
    ];
    const rows = data.map(r => [
      r.case_owner || "",
      r.site_id || "",
      r.case_id || "",
      r.panel_manufacturer || "",
      r.current_status || "",
      getDaysInCurrentStatus(r),
      getDaysOpen(r),
      r.updated_date ? new Date(r.updated_date).toLocaleString() : "",
      r.rma_url || "",
      (r.notes || "").replace(/"/g, '""').replace(/\n/g, ' ')
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v)}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pv_panel_rmas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} RMA${data.length !== 1 ? "s" : ""} to CSV`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">PV Panel RMA Tracker</h1>
            <p className="text-slate-500 mt-1">Track and manage PV panel RMA cases across the team</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 lg:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search RMAs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 w-full lg:w-64"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport(true)}>
                  Export Filtered Results
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport(false)}>
                  Export All Records
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-2" />
              Add New RMA
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setQuickFilter(f.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                quickFilter === f.value
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="dashboard">
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="w-4 h-4 mr-2" />
              List View
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-4">
            <RMADashboard rmas={filteredRmas} />
          </TabsContent>
          <TabsContent value="list" className="mt-4">
            <RMAList rmas={filteredRmas} onEdit={handleEdit} isLoading={isLoading} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setEditingRma(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRma ? "Edit RMA" : "Add New RMA"}</DialogTitle>
          </DialogHeader>
          <RMAForm
            key={editingRma?.id || "new"}
            rma={editingRma}
            users={users}
            manufacturers={manufacturers}
            defaultOwner={currentUser?.email}
            onSave={(formData) => saveMutation.mutate({ formData, existingRma: editingRma })}
            onCancel={() => { setShowForm(false); setEditingRma(null); }}
            isLoading={saveMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PVPanelRMAs() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <PVPanelRMAsContent />
    </RoleGuard>
  );
}