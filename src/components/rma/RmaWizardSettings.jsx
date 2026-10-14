import {useMemo, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {createLocalRecord, updateLocalRecord} from "@/api/dataClient";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Mail, Plus, Settings2} from "lucide-react";
import {toast} from "sonner";
import {
  DEFAULT_RMA_EMAIL_SUBJECT,
  RMA_SUBMISSION_METHODS,
  RMA_TEMPLATE_TOKENS,
  validateRmaWizardSettings
} from "@/features/rma/manufacturerSubmission";

const methodLabel = value => RMA_SUBMISSION_METHODS.find(option => option.value === value)?.label || "Not configured";

function toForm(record) {
  return {
    name: record?.name || "",
    rma_submission_method: record?.rma_submission_method || "form",
    rma_form_url: record?.rma_form_url || "",
    rma_email_to: record?.rma_email_to || "",
    rma_email_cc: record?.rma_email_cc || "",
    rma_email_subject: record?.rma_email_subject || DEFAULT_RMA_EMAIL_SUBJECT,
    rma_email_intro: record?.rma_email_intro || "",
    rma_instructions: record?.rma_instructions || ""
  };
}

/** Panel RMA Tracker tab: tells the RMA wizard how each manufacturer accepts claims. */
export default function RmaWizardSettings({manufacturers = [], userEmail = ""}) {
  const queryClient = useQueryClient();
  const sorted = useMemo(() => [...manufacturers].filter(item => item?.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name))), [manufacturers]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const isNew = selectedId === "__new";
  const set = (key, value) => setForm(previous => ({...previous, [key]: value}));

  function select(id) {
    setSelectedId(id);
    setErrors([]);
    setForm(toForm(id === "__new" ? null : sorted.find(item => item.id === id)));
  }

  async function save() {
    const problems = validateRmaWizardSettings(form);
    const duplicate = sorted.find(item => item.id !== selectedId && item.name.trim().toLowerCase() === form.name.trim().toLowerCase());
    if (duplicate) problems.push(`${duplicate.name} already exists. Select it from the list instead.`);
    setErrors(problems);
    if (problems.length) return;
    setSaving(true);
    try {
      const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, String(value ?? "").trim()]));
      const changes = {...values, rma_settings_updated_by: userEmail, rma_settings_updated_at: new Date().toISOString()};
      const saved = isNew ? await createLocalRecord("pvManufacturers", changes)
        : await updateLocalRecord("pvManufacturers", selectedId, changes);
      await queryClient.invalidateQueries({queryKey: ["pvManufacturers"]});
      if (isNew && saved?.id) setSelectedId(saved.id);
      toast.success(`RMA wizard settings saved for ${values.name}; shared after desktop sync.`);
    } catch (error) {
      toast.error(error.message || "Could not save RMA wizard settings.");
    } finally {
      setSaving(false);
    }
  }

  const usesEmail = form && (form.rma_submission_method === "email" || form.rma_submission_method === "both");
  const usesForm = form && (form.rma_submission_method === "form" || form.rma_submission_method === "both");

  return <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_2fr]" data-rma-wizard-settings>
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Manufacturers</h3>
        <Button size="sm" variant="outline" onClick={() => select("__new")}><Plus className="w-4 h-4 mr-1"/>Add</Button>
      </div>
      <p className="text-xs text-muted-foreground">Choose how the Panel RMA wizard submits claims for each manufacturer.</p>
      {!sorted.length && <p className="text-sm text-muted-foreground">No manufacturers yet. Add one, or save an RMA to create it.</p>}
      <div className="space-y-1">
        {sorted.map(item => <button key={item.id} type="button" data-rma-settings-manufacturer={item.name}
          onClick={() => select(item.id)}
          className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${selectedId === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
          <span className="block font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">{item.rma_submission_method ? methodLabel(item.rma_submission_method) : "Not configured (uses SOP links)"}</span>
        </button>)}
      </div>
    </Card>
    <Card className="p-4">
      {!form ? <div className="py-10 text-center text-muted-foreground">
        <Settings2 className="w-10 h-10 mx-auto mb-3 text-slate-300"/>
        Select a manufacturer to configure its RMA submission.
      </div> : <div className="space-y-4">
        <h3 className="font-semibold">{isNew ? "New manufacturer" : form.name}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="rma-settings-name">Manufacturer name</Label>
            <Input id="rma-settings-name" value={form.name} readOnly={!isNew} onChange={event => set("name", event.target.value)} placeholder="e.g. REC" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rma-settings-method">Submission method</Label>
            <Select value={form.rma_submission_method} onValueChange={value => set("rma_submission_method", value)}>
              <SelectTrigger id="rma-settings-method" aria-label="Submission method"><SelectValue /></SelectTrigger>
              <SelectContent>{RMA_SUBMISSION_METHODS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {usesForm && <div className="space-y-1">
          <Label htmlFor="rma-settings-form-url">Claim form / portal URL (optional)</Label>
          <Input id="rma-settings-form-url" value={form.rma_form_url} onChange={event => set("rma_form_url", event.target.value)} placeholder="https://manufacturer.example/warranty-claim" />
          <p className="text-xs text-muted-foreground">Shown first in the wizard. SOP links and saved forms still appear below it.</p>
        </div>}
        {usesEmail && <div className="space-y-3 rounded border border-border p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Mail className="w-4 h-4"/>Email submission</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rma-settings-to">To</Label>
              <Input id="rma-settings-to" value={form.rma_email_to} onChange={event => set("rma_email_to", event.target.value)} placeholder="warranty@manufacturer.example" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rma-settings-cc">Cc (optional)</Label>
              <Input id="rma-settings-cc" value={form.rma_email_cc} onChange={event => set("rma_email_cc", event.target.value)} placeholder="Separate addresses with commas" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rma-settings-subject">Subject</Label>
            <Input id="rma-settings-subject" value={form.rma_email_subject} onChange={event => set("rma_email_subject", event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rma-settings-intro">Opening message (optional)</Label>
            <Textarea id="rma-settings-intro" rows={3} value={form.rma_email_intro} onChange={event => set("rma_email_intro", event.target.value)}
              placeholder="Hello, please open a warranty claim for the module(s) below." />
          </div>
          <p className="text-xs text-muted-foreground">Placeholders: {RMA_TEMPLATE_TOKENS.join(" ")}. The wizard adds case, panel, serial and diagnosis details below the opening message. Attachments are added in your email app.</p>
        </div>}
        <div className="space-y-1">
          <Label htmlFor="rma-settings-instructions">Instructions shown in the wizard (optional)</Label>
          <Textarea id="rma-settings-instructions" rows={3} value={form.rma_instructions} onChange={event => set("rma_instructions", event.target.value)}
            placeholder="e.g. Attach the flash test report and photos of the label and damage." />
        </div>
        {errors.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-destructive">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
        <div className="flex items-center justify-between gap-2">
          {!isNew && sorted.find(item => item.id === selectedId)?.rma_settings_updated_at
            ? <Badge variant="secondary">Updated {new Date(sorted.find(item => item.id === selectedId).rma_settings_updated_at).toLocaleString()}</Badge> : <span />}
          <Button data-save-rma-settings disabled={saving} onClick={save}>{saving ? "Saving..." : "Save settings"}</Button>
        </div>
      </div>}
    </Card>
  </div>;
}
