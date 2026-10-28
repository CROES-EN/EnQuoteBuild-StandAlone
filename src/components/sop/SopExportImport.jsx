import React, {useRef, useState} from "react";
import {FileUp, Loader2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {sopsApi} from "@/features/collab/collabApi";
import {ACCEPTED_FILE_TYPES, formatBytes, sopFileType} from "./SopFilePreview";

export default function SopExportImport({sections, selectedSectionId, onImported}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [sectionId, setSectionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef([]);

  const chooseFiles = event => {
    const selected = [...event.target.files];
    event.target.value = "";
    if (selected.length > 20 || selected.some(file => file.size > 20 * 1024 * 1024 || !ACCEPTED_FILE_TYPES.includes(sopFileType(file)))) {
      setError("Choose up to 20 PDF, Word, image, or text exports, each 20 MB or smaller.");
      return;
    }
    pending.current = selected.map(file => ({file, id: crypto.randomUUID()}));
    setFiles(pending.current);
    setError("");
  };
  const importFiles = async () => {
    const section = sections.find(item => item.id === sectionId);
    if (!section || !pending.current.length) { setError("Choose a destination section and at least one export."); return; }
    setSaving(true);
    setError("");
    let lastId;
    try {
      for (const item of pending.current) {
        if (item.saved) { lastId = item.id; continue; }
        if (!item.uploaded) item.uploaded = await sopsApi.uploadFile({
          name: item.file.name, type: sopFileType(item.file), bytes: new Uint8Array(await item.file.arrayBuffer())
        });
        if (!item.uploaded?.fileId) throw new Error("The shared service did not confirm the uploaded file.");
        const result = await sopsApi.save({
          id: item.id, title: item.file.name.replace(/\.[^.]+$/, "") || item.file.name,
          section_id: section.id, category: section.title, parent_id: null,
          summary: "Imported document export", content_html: "", files: [item.uploaded], tags: []
        });
        if (!result?.ok || !result.record?.id) throw new Error("The SOP page was not confirmed. Previously imported pages were kept; retry the remaining files.");
        item.saved = true;
        lastId = item.id;
        setFiles([...pending.current]);
      }
      toast.success(`Imported ${pending.current.length} document export(s).`);
      setOpen(false);
      pending.current = [];
      setFiles([]);
      onImported(section.id, lastId);
    } catch (failure) {
      setError(`${failure.message} Completed pages were kept. Retry to continue without duplicating them.`);
    } finally { setSaving(false); }
  };
  return <>
    <Button variant="outline" onClick={() => { if (!files.some(item => item.saved)) setSectionId(selectedSectionId || sections[0]?.id || ""); setOpen(true); }}>
      <FileUp className="mr-1 h-4 w-4" /> Import OneNote export
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import document exports</DialogTitle>
          <DialogDescription>Export OneNote pages as PDF or Word, then upload them here. The browser cannot convert .one files or automate OneNote. Each export becomes a shared SOP page with a preview and downloadable original.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="sop-export-section">Destination section</Label>
        <Select value={sectionId} onValueChange={setSectionId} disabled={saving || files.some(item => item.saved)}>
          <SelectTrigger id="sop-export-section"><SelectValue /></SelectTrigger>
          <SelectContent>{sections.map(section => <SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>)}</SelectContent>
        </Select>
        <Label htmlFor="sop-export-files">Exported files</Label>
        <input id="sop-export-files" type="file" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp" onChange={chooseFiles} disabled={saving || files.some(item => item.saved)} />
        <ul className="max-h-48 overflow-auto text-sm">{files.map(item => <li key={item.id}>{item.file.name} ({formatBytes(item.file.size)}){item.saved ? " - Imported" : ""}</li>)}</ul>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={saving || !files.length || !sectionId} onClick={importFiles}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{saving ? "Importing..." : "Import exports"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
