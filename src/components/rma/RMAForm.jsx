import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RMA_STATUSES } from "@/components/rma/rmaUtils";
import { format } from "date-fns";
import { Plus, X, History } from "lucide-react";

export default function RMAForm({ rma, users, manufacturers, defaultOwner, onSave, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    case_owner: rma?.case_owner || defaultOwner || "",
    site_id: rma?.site_id || "",
    case_id: rma?.case_id || "",
    panel_manufacturer: rma?.panel_manufacturer || "",
    current_status: rma?.current_status || "New",
    rma_url: rma?.rma_url || "",
    notes: rma?.notes || ""
  });
  const [showNewMfr, setShowNewMfr] = useState(false);
  const [newMfr, setNewMfr] = useState("");

  const handleChange = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleAddManufacturer = () => {
    if (newMfr.trim()) {
      handleChange("panel_manufacturer", newMfr.trim());
      setNewMfr("");
      setShowNewMfr(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Case Owner</Label>
          <Select value={formData.case_owner} onValueChange={v => handleChange("case_owner", v)}>
            <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
            <SelectContent>
              {users.map(u => (
                <SelectItem key={u.id} value={u.email}>
                  {u.full_name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Site ID *</Label>
          <Input value={formData.site_id} onChange={e => handleChange("site_id", e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Case ID *</Label>
          <Input value={formData.case_id} onChange={e => handleChange("case_id", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Panel Manufacturer *</Label>
          {!showNewMfr ? (
            <div className="flex gap-2">
              <Select value={formData.panel_manufacturer} onValueChange={v => handleChange("panel_manufacturer", v)}>
                <SelectTrigger><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                <SelectContent>
                  {manufacturers.map(m => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" onClick={() => setShowNewMfr(true)}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={newMfr}
                onChange={e => setNewMfr(e.target.value)}
                placeholder="Enter manufacturer name"
                autoFocus
              />
              <Button type="button" size="sm" onClick={handleAddManufacturer}>Add</Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => { setShowNewMfr(false); setNewMfr(""); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Current Status</Label>
          <Select value={formData.current_status} onValueChange={v => handleChange("current_status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RMA_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>RMA URL</Label>
          <Input
            type="url"
            value={formData.rma_url}
            onChange={e => handleChange("rma_url", e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notes / Details</Label>
        <Textarea
          rows={5}
          value={formData.notes}
          onChange={e => handleChange("notes", e.target.value)}
          placeholder="Add notes, ongoing updates, and details about this RMA..."
        />
      </div>

      {rma?.status_history?.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <History className="w-4 h-4" />
            Status History
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5 max-h-48 overflow-y-auto">
            {rma.status_history.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-slate-500 whitespace-nowrap min-w-[100px]">
                  {entry.changed_at ? format(new Date(entry.changed_at), "MMM d, yyyy") : "—"}
                </span>
                <span className="text-slate-300">→</span>
                <span className="font-medium text-slate-800">{entry.new_status}</span>
                {entry.previous_status && (
                  <span className="text-slate-400 text-xs">(from {entry.previous_status})</span>
                )}
                <span className="text-slate-400 text-xs ml-auto">by {entry.changed_by}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : (rma ? "Update RMA" : "Create RMA")}
        </Button>
      </div>
    </form>
  );
}