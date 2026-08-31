import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  MapPin,
  Navigation,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Route,
  Loader2,
  Trophy,
  ChevronUp,
  ChevronDown,
  Phone
} from "lucide-react";
import RoleGuard from "@/components/auth/RoleGuard";

const emptyFST = { name: "", employee_id: "", city: "", state: "", zip: "", phone: "", is_active: true, notes: "" };

function ResourcePlannerPage() {
  const queryClient = useQueryClient();

  // FST Roster state
  const [showFSTForm, setShowFSTForm] = useState(false);
  const [editingFST, setEditingFST] = useState(null);
  const [fstForm, setFstForm] = useState(emptyFST);

  // Routing state
  const [svAddress, setSvAddress] = useState("");
  const [rankings, setRankings] = useState(null);
  const [isRanking, setIsRanking] = useState(false);
  const [rankError, setRankError] = useState(null);

  const { data: fsts = [], isLoading: fstsLoading } = useQuery({
    queryKey: ["fsts"],
    queryFn: () => base44.entities.FST.list("name", 200)
  });

  const activeFSTs = fsts.filter(f => f.is_active !== false);

  const createFST = useMutation({
    mutationFn: (data) => base44.entities.FST.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fsts"] }); closeForm(); }
  });

  const updateFST = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FST.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fsts"] }); closeForm(); }
  });

  const deleteFST = useMutation({
    mutationFn: (id) => base44.entities.FST.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fsts"] })
  });

  const closeForm = () => {
    setShowFSTForm(false);
    setEditingFST(null);
    setFstForm(emptyFST);
  };

  const openEdit = (fst) => {
    setEditingFST(fst);
    setFstForm({ ...emptyFST, ...fst });
    setShowFSTForm(true);
  };

  const handleFSTSubmit = (e) => {
    e.preventDefault();
    if (editingFST) {
      updateFST.mutate({ id: editingFST.id, data: fstForm });
    } else {
      createFST.mutate(fstForm);
    }
  };

  const handleRank = async () => {
    if (!svAddress.trim()) return;
    if (activeFSTs.length === 0) {
      setRankError("No active FSTs in the roster. Please add FSTs first.");
      return;
    }
    setIsRanking(true);
    setRankings(null);
    setRankError(null);
    try {
      const response = await base44.functions.invoke("rankFSTs", {
        sv_address: svAddress,
        fsts: activeFSTs.map(f => ({
          name: f.name,
          address: `${f.city || ""}, ${f.state || ""} ${f.zip || ""}`.trim(),
          city: f.city || "",
          state: f.state || "",
          zip: f.zip || ""
        }))
      });
      setRankings(response.data?.rankings || []);
    } catch (err) {
      setRankError("Failed to rank FSTs. Please try again.");
    } finally {
      setIsRanking(false);
    }
  };

  const rankColor = (index) => {
    if (index === 0) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (index === 1) return "bg-sky-100 text-sky-700 border-sky-200";
    if (index === 2) return "bg-violet-100 text-violet-700 border-violet-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center">
          <Route className="w-5 h-5 text-sky-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Resource Planner</h1>
          <p className="text-sm text-slate-500">AI-powered FST routing for site visits</p>
        </div>
      </div>

      <Tabs defaultValue="route">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="route" className="gap-2">
            <Navigation className="w-4 h-4" /> Route Planner
          </TabsTrigger>
          <TabsTrigger value="roster" className="gap-2">
            <Users className="w-4 h-4" /> FST Roster
            {activeFSTs.length > 0 && (
              <Badge className="ml-1 bg-sky-600 text-white text-xs px-1.5 py-0">{activeFSTs.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── ROUTE PLANNER TAB ─── */}
        <TabsContent value="route" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-sky-600" />
                Enter Site Visit Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="e.g. 123 Main St, Denver, CO 80202"
                  value={svAddress}
                  onChange={(e) => setSvAddress(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRank()}
                  className="flex-1"
                />
                <Button
                  onClick={handleRank}
                  disabled={isRanking || !svAddress.trim()}
                  className="bg-sky-600 hover:bg-sky-700 gap-2 shrink-0"
                >
                  {isRanking ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Navigation className="w-4 h-4" /> Find Best FST</>
                  )}
                </Button>
              </div>
              {activeFSTs.length === 0 && !fstsLoading && (
                <p className="text-sm text-amber-600 flex items-center gap-1">
                  ⚠️ No active FSTs in roster. Add FSTs in the <strong>FST Roster</strong> tab first.
                </p>
              )}
              {activeFSTs.length > 0 && (
                <p className="text-xs text-slate-400">{activeFSTs.length} active FST{activeFSTs.length !== 1 ? "s" : ""} will be evaluated</p>
              )}
            </CardContent>
          </Card>

          {rankError && (
            <Card className="border-rose-200 bg-rose-50">
              <CardContent className="pt-4 pb-4 text-sm text-rose-700">{rankError}</CardContent>
            </Card>
          )}

          {isRanking && (
            <Card>
              <CardContent className="py-12 text-center text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-sky-500" />
                <p className="font-medium">AI is calculating routes...</p>
                <p className="text-sm text-slate-400 mt-1">Estimating distance and travel time for each FST</p>
              </CardContent>
            </Card>
          )}

          {rankings && rankings.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Ranked from closest to furthest for: <strong className="text-slate-800">{svAddress}</strong></span>
              </div>
              {rankings.map((r, index) => (
                <Card key={index} className={`border ${index === 0 ? "border-emerald-200 shadow-emerald-50 shadow-md" : "border-slate-200"}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start gap-4">
                      {/* Rank badge */}
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border ${rankColor(index)} shrink-0 mt-0.5`}>
                        #{index + 1}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-900 text-base">{r.name}</span>
                          {index === 0 && (
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Best Match</Badge>
                          )}
                        </div>
                        {/* FST address */}
                        {(() => {
                          const fst = activeFSTs.find(f => f.name === r.name);
                          return fst ? (
                            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {fst.city}{fst.state ? `, ${fst.state}` : ""} {fst.zip || ""}
                              </p>
                          ) : null;
                        })()}
                        <p className="text-sm text-slate-500">{r.notes}</p>
                      </div>
                      {/* Metrics */}
                      <div className="flex gap-4 shrink-0 text-right">
                        <div>
                          <p className="text-xs text-slate-400">Distance</p>
                          <p className="font-bold text-slate-800">{r.estimated_miles} mi</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Drive Time</p>
                          <p className="font-bold text-slate-800 flex items-center gap-1 justify-end">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {r.estimated_hours_display}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-slate-400 text-center pt-1">
                Estimates are AI-generated based on geographic knowledge. Actual drive times may vary with traffic conditions.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ─── FST ROSTER TAB ─── */}
        <TabsContent value="roster" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">{fsts.length} FST{fsts.length !== 1 ? "s" : ""} total · {activeFSTs.length} active</p>
            <Button
              onClick={() => { setEditingFST(null); setFstForm(emptyFST); setShowFSTForm(true); }}
              className="bg-sky-600 hover:bg-sky-700 gap-2"
            >
              <Plus className="w-4 h-4" /> Add FST
            </Button>
          </div>

          {fstsLoading ? (
            <Card><CardContent className="py-10 text-center text-slate-400">Loading roster...</CardContent></Card>
          ) : fsts.length === 0 ? (
            <Card className="border-dashed border-slate-300">
              <CardContent className="py-12 text-center text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p className="font-medium">No FSTs yet</p>
                <p className="text-sm mt-1">Add your first FST to start routing site visits</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fsts.map((fst) => (
                <Card key={fst.id} className={`${!fst.is_active ? "opacity-60" : ""}`}>
                  <CardContent className="pt-4 pb-4 px-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-900">{fst.name}</span>
                          {fst.employee_id && <span className="text-xs text-slate-400">#{fst.employee_id}</span>}
                          {!fst.is_active && <Badge className="bg-slate-100 text-slate-500 border-0 text-xs">Inactive</Badge>}
                        </div>
                        <p className="text-sm text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {fst.city}{fst.state ? `, ${fst.state}` : ""} {fst.zip || ""}
                        </p>
                        {fst.phone && (
                          <p className="text-sm text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 shrink-0" />
                            {fst.phone}
                          </p>
                        )}
                        {fst.notes && <p className="text-xs text-slate-400 mt-1 truncate">{fst.notes}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(fst)}>
                          <Pencil className="w-3.5 h-3.5 text-slate-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:text-rose-600"
                          onClick={() => { if (confirm(`Remove ${fst.name} from roster?`)) deleteFST.mutate(fst.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit FST Dialog */}
      <Dialog open={showFSTForm} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingFST ? "Edit FST" : "Add New FST"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFSTSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Full Name <span className="text-rose-500">*</span></Label>
                <Input
                  placeholder="John Smith"
                  value={fstForm.name}
                  onChange={(e) => setFstForm({ ...fstForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employee ID</Label>
                <Input
                  placeholder="EMP-001"
                  value={fstForm.employee_id}
                  onChange={(e) => setFstForm({ ...fstForm, employee_id: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  placeholder="(555) 123-4567"
                  value={fstForm.phone}
                  onChange={(e) => setFstForm({ ...fstForm, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input
                  placeholder="Denver"
                  value={fstForm.city}
                  onChange={(e) => setFstForm({ ...fstForm, city: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input
                    placeholder="CO"
                    maxLength={2}
                    value={fstForm.state}
                    onChange={(e) => setFstForm({ ...fstForm, state: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>ZIP</Label>
                  <Input
                    placeholder="80202"
                    value={fstForm.zip}
                    onChange={(e) => setFstForm({ ...fstForm, zip: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Any relevant info about this FST..."
                  value={fstForm.notes}
                  onChange={(e) => setFstForm({ ...fstForm, notes: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <Switch
                  id="fst_active"
                  checked={fstForm.is_active !== false}
                  onCheckedChange={(val) => setFstForm({ ...fstForm, is_active: val })}
                />
                <Label htmlFor="fst_active" className="cursor-pointer">Active (included in routing)</Label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                className="bg-sky-600 hover:bg-sky-700"
                disabled={createFST.isPending || updateFST.isPending}
              >
                {createFST.isPending || updateFST.isPending ? "Saving..." : editingFST ? "Save Changes" : "Add FST"}
              </Button>
              <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ResourcePlanner() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <ResourcePlannerPage />
    </RoleGuard>
  );
}