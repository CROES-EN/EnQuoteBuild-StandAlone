import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {RMA_STATUSES} from "@/components/rma/rmaUtils";
import {format} from "date-fns";
import {History, Plus, X} from "lucide-react";
import RmaSopAssistant from "./RmaSopAssistant";

export default function RMAForm({ rma, users, manufacturers, defaultOwner, onSave, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    case_owner: rma?.case_owner || defaultOwner || "",
    site_id: rma?.site_id || "",
    case_id: rma?.case_id || "",
    panel_manufacturer: rma?.panel_manufacturer || "",
    panel_model: rma?.panel_model || "",
    panel_quantity: rma?.panel_quantity ?? "",
    serial_numbers: rma?.serial_numbers || "",
    manufacturer_rma_number: rma?.manufacturer_rma_number || "",
    current_status: rma?.current_status || "New",
    rma_url: rma?.rma_url || "",
    notes: rma?.notes || "",
    submission_preparation: rma?.submission_preparation || {}
  });
  const [showNewMfr, setShowNewMfr] = useState(false);
  const [newMfr, setNewMfr] = useState("");
  const [step, setStep] = useState(0);
  const [configSaving, setConfigSaving] = useState(false);
  const steps = ["Manufacturer & case", "Panel details", "Forms & evidence", "Review & save"];
  function next() {
    if (step === 0 && (!formData.case_id.trim() || !formData.site_id.trim() || !formData.panel_manufacturer.trim())) {
      document.getElementById("rma-case")?.closest("form")?.reportValidity();
      return;
    }
    if (step === 1 && !document.getElementById("rma-quantity")?.reportValidity()) return;
    setStep(value => Math.min(value + 1, 3));
  }

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
    if (isLoading) return;
    // Enter advances through the wizard; saving only happens from the explicit Save button.
    if (step !== 3) next();
  };
  const step0Valid = Boolean(formData.case_id.trim() && formData.site_id.trim() && formData.panel_manufacturer.trim());
  const goToStep = (target) => {
    if (target === step) return;
    if (target > 0 && !step0Valid) { next(); return; }
    if (target > 1 && step <= 1 && !document.getElementById("rma-quantity")?.reportValidity()) return;
    setStep(target);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset disabled={isLoading || configSaving} className="space-y-5">
      <div className="space-y-2">
        <p role="status" className="font-semibold">Step {step + 1} of 4: {steps[step]}</p>
        <ol className="grid grid-cols-4 gap-1.5" aria-label="RMA wizard steps">
          {steps.map((label, index) => (
            <li key={label}>
              <button type="button" onClick={() => goToStep(index)} aria-current={index === step ? "step" : undefined}
                className="w-full text-left" title={label} data-rma-step={index}>
                <span className={`block h-1.5 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`} />
                <span className={`mt-1 block truncate text-[11px] ${index === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div hidden={step !== 0} className="space-y-5">
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
          <Label htmlFor="rma-site">Site ID *</Label>
          <Input id="rma-site" value={formData.site_id} onChange={e => handleChange("site_id", e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="rma-case">Case ID *</Label>
          <Input id="rma-case" value={formData.case_id} onChange={e => handleChange("case_id", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Panel Manufacturer *</Label>
          {!showNewMfr ? (
            <div className="flex gap-2">
              <Select value={formData.panel_manufacturer} onValueChange={v => handleChange("panel_manufacturer", v)}>
                <SelectTrigger aria-label="Panel Manufacturer"><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
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
                aria-label="New manufacturer name"
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

      </div>
      <div hidden={step !== 1} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label htmlFor="rma-model">Panel Model</Label>
          <Input id="rma-model" value={formData.panel_model} onChange={e => handleChange("panel_model", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rma-quantity">Panel Quantity</Label>
          <Input id="rma-quantity" type="number" min={1} max={10000} step={1} value={formData.panel_quantity}
            onChange={e => handleChange("panel_quantity", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rma-number">Manufacturer RMA Number</Label>
          <Input id="rma-number" value={formData.manufacturer_rma_number} onChange={e => handleChange("manufacturer_rma_number", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rma-serials">Serial Numbers</Label>
          <Textarea id="rma-serials" rows={3} value={formData.serial_numbers} onChange={e => handleChange("serial_numbers", e.target.value)}
            placeholder="One panel serial number per line" /></div>
      </div>
      </div>
      <div hidden={step !== 3} className="space-y-5">
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
      </div>

      <div hidden={step !== 2}>
      <RmaSopAssistant data={formData} preparation={formData.submission_preparation}
        onChange={value => handleChange("submission_preparation", value)} onBusyChange={setConfigSaving} />
      </div>

      {step === 3 && <div className="rounded border border-border p-3 text-sm">
        <h3 className="font-semibold">Review before saving</h3>
        <p>Case {formData.case_id} · Site {formData.site_id} · {formData.panel_manufacturer}</p>
        <p>Model: {formData.panel_model || "Not provided"} · Quantity: {formData.panel_quantity || "Not provided"}</p>
        <p>Serial numbers: {formData.serial_numbers || "Not provided"}</p>
        <p>Saving tracks your request only. It does not submit the manufacturer form or confirm warranty eligibility.</p>
      </div>}
      {step === 3 && rma?.status_history?.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History className="w-4 h-4" />
            Status History
          </div>
          <div className="rounded-lg border border-border bg-secondary p-4 space-y-2.5 max-h-48 overflow-y-auto">
            {rma.status_history.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground whitespace-nowrap min-w-[100px]">
                  {entry.changed_at ? format(new Date(entry.changed_at), "MMM d, yyyy") : "—"}
                </span>
                <span className="text-slate-300">→</span>
                <span className="font-medium text-foreground">{entry.new_status}</span>
                {entry.previous_status && (
                  <span className="text-muted-foreground text-xs">(from {entry.previous_status})</span>
                )}
                <span className="text-muted-foreground text-xs ml-auto">by {entry.changed_by}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        {step > 0 && <Button type="button" variant="outline" onClick={() => setStep(value => value - 1)}>Back</Button>}
        {step < 3 ? <Button key="rma-next" type="button" onClick={next}
          disabled={step === 0 && !step0Valid}>Next</Button> : <Button key="rma-save" type="button" disabled={isLoading}
          onClick={() => { if (!isLoading) onSave(formData); }} data-rma-save>
          {isLoading ? "Saving..." : (rma?.id ? "Update RMA" : "Create RMA")}
        </Button>}
      </div>
      </fieldset>
    </form>
  );
}