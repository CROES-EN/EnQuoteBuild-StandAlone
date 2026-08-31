import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createLocalRecord, getCurrentUser, listLocalCollection } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Plus, User, Calendar } from "lucide-react";
import { format } from "date-fns";
import RoleGuard from "@/components/auth/RoleGuard";

function SVCancelTrackerPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    site_id: "",
    case_id: "",
    cancel_count: "",
    ho_contacted: false,
    notes: ""
  });

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["svCancelTracker"],
    queryFn: () => listLocalCollection("svCancels")
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: getCurrentUser
  });

  const createMutation = useMutation({
    mutationFn: (data) => createLocalRecord("svCancels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["svCancelTracker"] });
      setForm({ site_id: "", case_id: "", cancel_count: "", ho_contacted: false, notes: "" });
      setShowForm(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      cancel_count: parseInt(form.cancel_count) || 1,
      submitted_by: currentUser?.email || ""
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">SV Cancel Tracker</h1>
            <p className="text-sm text-slate-500">Track canceled and rescheduled site visit escalations</p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-rose-600 hover:bg-rose-700 gap-2"
        >
          <Plus className="w-4 h-4" />
          Log Escalation
        </Button>
      </div>

      {/* Submission Form */}
      {showForm && (
        <Card className="border-rose-200 bg-rose-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-800">New Cancellation Escalation</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="site_id">Site ID <span className="text-rose-500">*</span></Label>
                  <Input
                    id="site_id"
                    placeholder="e.g. 12345"
                    value={form.site_id}
                    onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="case_id">Case ID <span className="text-rose-500">*</span></Label>
                  <Input
                    id="case_id"
                    placeholder="e.g. CS-98765"
                    value={form.case_id}
                    onChange={(e) => setForm({ ...form, case_id: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cancel_count"># of Cancels / Reschedules <span className="text-rose-500">*</span></Label>
                <Input
                  id="cancel_count"
                  type="number"
                  min="1"
                  placeholder="e.g. 2"
                  value={form.cancel_count}
                  onChange={(e) => setForm({ ...form, cancel_count: e.target.value })}
                  required
                  className="w-40"
                />
              </div>

              <div className="flex items-center gap-3 py-1">
                <Switch
                  id="ho_contacted"
                  checked={form.ho_contacted}
                  onCheckedChange={(val) => setForm({ ...form, ho_contacted: val })}
                />
                <Label htmlFor="ho_contacted" className="cursor-pointer">
                  HO was contacted about the reschedule
                </Label>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional context, what happened, next steps..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" className="bg-rose-600 hover:bg-rose-700" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Submitting..." : "Submit Escalation"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-slate-500 mb-1">Total Escalations</p>
            <p className="text-2xl font-bold text-slate-900">{records.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-slate-500 mb-1">Total Cancels</p>
            <p className="text-2xl font-bold text-rose-600">
              {records.reduce((sum, r) => sum + (r.cancel_count || 0), 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-slate-500 mb-1">HO Contacted</p>
            <p className="text-2xl font-bold text-emerald-600">
              {records.filter(r => r.ho_contacted).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-slate-500 mb-1">HO Not Contacted</p>
            <p className="text-2xl font-bold text-amber-600">
              {records.filter(r => !r.ho_contacted).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Records Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Escalation Records</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Loading...</div>
          ) : records.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p>No escalations logged yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {records.map((record) => (
                <div key={record.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">
                    <div>
                      <p className="text-xs text-slate-400">Site ID</p>
                      <p className="font-semibold text-slate-900">{record.site_id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Case ID</p>
                      <p className="font-medium text-slate-700">{record.case_id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Cancels</p>
                      <p className="font-semibold text-rose-600">{record.cancel_count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">HO Contacted</p>
                      <Badge className={record.ho_contacted
                        ? "bg-emerald-100 text-emerald-700 border-0"
                        : "bg-amber-100 text-amber-700 border-0"}>
                        {record.ho_contacted ? "Yes" : "No"}
                      </Badge>
                    </div>
                  </div>
                  {record.notes && (
                    <p className="text-sm text-slate-500 md:max-w-xs truncate">{record.notes}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-slate-400 shrink-0">
                    {record.submitted_by && (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {record.submitted_by}
                      </span>
                    )}
                    {record.created_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(record.created_date), "MMM d, yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SVCancelTrackerWithGuard() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <SVCancelTrackerPage />
    </RoleGuard>
  );
}