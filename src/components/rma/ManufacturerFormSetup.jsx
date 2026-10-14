import {useState} from "react";
import {sopsApi} from "@/features/collab/collabApi";
import {saveManufacturerForm} from "@/features/rma/manufacturerForms";
import {DOCX_TYPE} from "@/components/sop/SopFilePreview";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {toast} from "sonner";

export default function ManufacturerFormSetup({manufacturer, initialUrl, onSaved, onBusyChange}) {
  const [label, setLabel] = useState("Warranty claim form");
  const [url, setUrl] = useState(initialUrl || "");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      let upload;
      if (file) {
        const type = /\.pdf$/i.test(file.name) ? "application/pdf" : /\.docx$/i.test(file.name) ? DOCX_TYPE : "";
        if (!type) throw new Error("Choose a PDF or Word (.docx) form.");
        if (file.size > 20 * 1024 * 1024) throw new Error("Forms must be 20 MB or smaller.");
        upload = {name:file.name, type, bytes:new Uint8Array(await file.arrayBuffer())};
      }
      await saveManufacturerForm({manufacturer, label, url, file:upload}, sopsApi);
      const docs = await sopsApi.list();
      onSaved(docs);
      toast.success(`Form saved for ${manufacturer}. Available to the team through SOP Library.`);
    } catch (failure) {
      setError(failure.message || "Could not save the manufacturer form.");
      toast.error(failure.message || "Could not save the manufacturer form.");
    } finally {setSaving(false);onBusyChange(false);}
  }
  return <fieldset disabled={saving} className="space-y-2 rounded border border-border p-3">
    <h4 className="font-semibold">Add a reusable form for {manufacturer}</h4>
    <p className="text-xs text-muted-foreground">Save a portal link or upload a blank PDF/Word form once. It is stored in the shared SOP Library, independently of this case. Do not upload completed claims or passwords here.</p>
    <Label htmlFor="manufacturer-form-name">Form name</Label>
    <Input id="manufacturer-form-name" value={label} onChange={event => setLabel(event.target.value)} />
    <Label htmlFor="manufacturer-saved-form-url">Form or portal URL</Label>
    <Input id="manufacturer-saved-form-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://manufacturer.example/claim" />
    <Label htmlFor="manufacturer-form-file">Or upload a blank PDF/Word form</Label>
    <Input id="manufacturer-form-file" type="file" accept=".pdf,.docx" onChange={event => setFile(event.target.files?.[0] || null)} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button type="button" onClick={save} disabled={saving || !label.trim() || (!url.trim() && !file)}>
      {saving ? "Saving manufacturer form..." : "Save form for this manufacturer"}
    </Button>
  </fieldset>;
}
