import {useRef, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {createLocalRecord, importFstRoster, updateLocalRecord} from "@/api/dataClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Card, CardContent} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Switch} from "@/components/ui/switch";
import {Label} from "@/components/ui/label";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Dialog, DialogContent, DialogHeader, DialogTitle,} from "@/components/ui/dialog";
import {Loader2, Mail, MapPin, Navigation, Pencil, Phone, Plus, Route, Trash2, Upload, Users} from "lucide-react";
import RoleGuard from "@/components/auth/RoleGuard";
import FstRouteFinder from "@/components/resourcePlanner/FstRouteFinder";
import {FIELD_TEAM_SHEET, parseFieldTeamWorkbook} from "@/lib/fstRoster";
import {useFstRoster} from "@/lib/useFstRoster";

// FST roster records live in the local "fsts" collection (registered in
// electron/repository.cjs). shipping_address is where product material orders ship
// (the FST's U-Haul unit); home_address is where the FST drives from. home_geo/ship_geo
// cache the geocoded coordinates of those addresses so routing only has to look each
// one up once.
const emptyFST = {
  name: "",
  employee_id: "",
  supervisor: "",
  email: "",
  phone: "",
  shipping_address: "",
  home_address: "",
  region: "",
  home_state: "",
  fsl_case_no: "",
  city: "",
  state: "",
  zip: "",
  is_active: true,
  notes: ""
};

function ResourcePlannerPage() {
  // FST Roster state
  const [showFSTForm, setShowFSTForm] = useState(false);
  const [editingFST, setEditingFST] = useState(null);
  const [fstForm, setFstForm] = useState(emptyFST);

  // Excel import state
  const importInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState(null);

  const { fsts, activeFSTs, isLoading: fstsLoading, afterRosterWrite } = useFstRoster();

  const createFST = useMutation({
    mutationFn: (data) => createLocalRecord("fsts", data),
    onSuccess: () => { afterRosterWrite(); closeForm(); }
  });

  const updateFST = useMutation({
    mutationFn: ({ id, data }) => updateLocalRecord("fsts", id, data),
    onSuccess: () => { afterRosterWrite(); closeForm(); }
  });

  // Soft delete so the removal syncs to every other user like any other edit.
  const deleteFST = useMutation({
    mutationFn: (id) => updateLocalRecord("fsts", id, { is_deleted: true }),
    onSuccess: afterRosterWrite
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

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsImporting(true);
    setImportMessage(null);
    try {
      const parsed = parseFieldTeamWorkbook(await file.arrayBuffer());
      if (parsed.length === 0) throw new Error(`No FSTs found on the "${FIELD_TEAM_SHEET}" tab.`);

      const { created, updated, unchanged } = await importFstRoster(parsed);
      afterRosterWrite();

      setImportMessage({
        type: "success",
        text: `Imported from "${FIELD_TEAM_SHEET}": ${created} added, ${updated} updated, ${unchanged} unchanged. Changes sync to all users.`
      });
    } catch (err) {
      setImportMessage({ type: "error", text: `Import failed: ${err?.message || "unknown error"}` });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center">
          <Route className="w-5 h-5 text-sky-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Resource Planner</h1>
          <p className="text-sm text-muted-foreground">Drive-time FST routing for site visits</p>
        </div>
      </div>

      <Tabs defaultValue="route">
        <TabsList className="bg-muted">
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

        {/* --- ROUTE PLANNER TAB --- */}
        <TabsContent value="route" className="space-y-4 mt-4">
          <FstRouteFinder />
        </TabsContent>
        {/* --- FST ROSTER TAB --- */}
        <TabsContent value="roster" className="space-y-4 mt-4">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">{fsts.length} FST{fsts.length !== 1 ? "s" : ""} total ・ {activeFSTs.length} active</p>
            <div className="flex gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                variant="outline"
                className="gap-2"
                disabled={isImporting}
                onClick={() => importInputRef.current?.click()}
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import from Excel
              </Button>
              <Button
                onClick={() => { setEditingFST(null); setFstForm(emptyFST); setShowFSTForm(true); }}
                className="bg-sky-600 hover:bg-sky-700 gap-2"
              >
                <Plus className="w-4 h-4" /> Add FST
              </Button>
            </div>
          </div>

          {importMessage && (
            <p className={`text-sm ${importMessage.type === "error" ? "text-rose-600" : "text-emerald-700"}`}>
              {importMessage.text}
            </p>
          )}

          {fstsLoading ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Loading roster...</CardContent></Card>
          ) : fsts.length === 0 ? (
            <Card className="border-dashed border-slate-300">
              <CardContent className="py-12 text-center text-muted-foreground">
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
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-foreground">{fst.name}</span>
                          {fst.employee_id && <span className="text-xs text-muted-foreground">#{fst.employee_id}</span>}
                          {fst.region && <Badge variant="outline" className="text-xs">{fst.region}</Badge>}
                          {!fst.is_active && <Badge className="bg-muted text-muted-foreground border-0 text-xs">Inactive</Badge>}
                        </div>
                        {fst.supervisor && (
                          <p className="text-xs text-muted-foreground mb-1">Supervisor: {fst.supervisor}</p>
                        )}
                        {fst.shipping_address && (
                          <p className="text-sm text-muted-foreground flex items-start gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                            <span><span className="font-medium text-foreground">Ship To:</span> {fst.shipping_address}</span>
                          </p>
                        )}
                        {fst.home_address && (
                          <p className="text-sm text-muted-foreground flex items-start gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                            <span><span className="font-medium text-foreground">Home:</span> {fst.home_address}</span>
                          </p>
                        )}
                        {!fst.shipping_address && !fst.home_address && (fst.city || fst.state || fst.zip) && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {fst.city}{fst.state ? `, ${fst.state}` : ""} {fst.zip || ""}
                          </p>
                        )}
                        {fst.phone && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 shrink-0" />
                            {fst.phone}
                          </p>
                        )}
                        {fst.email && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3 shrink-0" />
                            {fst.email}
                          </p>
                        )}
                        {fst.fsl_case_no && (
                          <p className="text-xs text-muted-foreground mt-0.5">FSL Case #: {fst.fsl_case_no}</p>
                        )}
                        {fst.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{fst.notes}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(fst)}>
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:text-rose-600"
                          onClick={() => { if (confirm(`Remove ${fst.name} from roster?`)) deleteFST.mutate(fst.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
                  placeholder="FS_1234567"
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
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="name@enphaseenergy.com"
                  value={fstForm.email}
                  onChange={(e) => setFstForm({ ...fstForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>FSL Case No</Label>
                <Input
                  value={fstForm.fsl_case_no}
                  onChange={(e) => setFstForm({ ...fstForm, fsl_case_no: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Supervisor</Label>
                <Input
                  placeholder="e.g. Arturo/Brian"
                  value={fstForm.supervisor}
                  onChange={(e) => setFstForm({ ...fstForm, supervisor: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Input
                  placeholder="e.g. NorCal West, socal"
                  value={fstForm.region}
                  onChange={(e) => setFstForm({ ...fstForm, region: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Shipping Address</Label>
                <Textarea
                  placeholder="Full shipping/U-Haul address for material orders"
                  value={fstForm.shipping_address}
                  onChange={(e) => setFstForm({ ...fstForm, shipping_address: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Home Address</Label>
                <Textarea
                  placeholder="Full home address"
                  value={fstForm.home_address}
                  onChange={(e) => setFstForm({ ...fstForm, home_address: e.target.value })}
                  rows={2}
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