import {useRef, useState} from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import {Loader2, Paperclip, Save, X} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {sopsApi} from "@/features/collab/collabApi";
import {ACCEPTED_FILE_TYPES, DOCX_TYPE, formatBytes} from "./SopFilePreview";
import {descendantPages, flattenPages, isParentPage, movePageBranch} from "./sopSections";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const QUILL_MODULES = {
  toolbar: [
    [{header: [1, 2, 3, false]}],
    ["bold", "italic", "underline", "strike"],
    [{list: "ordered"}, {list: "bullet"}],
    [{indent: "-1"}, {indent: "+1"}],
    ["link", "blockquote", "code-block"],
    [{color: []}, {background: []}],
    ["clean"]
  ]
};

// Windows sometimes reports an empty type for .docx/.txt files, so fall back to the extension.
function fileType(file) {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return DOCX_TYPE;
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "";
}

export function isSafeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function toDraft(doc) {
  return {
    id: doc?.id,
    section_id: doc?.section_id || "",
    order: Number.isFinite(Number(doc?.order)) ? Number(doc.order) : undefined,
    parent_id: doc?.parent_id || null,
    title: doc?.title || "",
    category: doc?.category || "",
    summary: doc?.summary || "",
    tags: (doc?.tags || []).join(", "),
    content_html: doc?.content_html || "",
    files: doc?.files || [],
    source_url: doc?.source_url || ""
  };
}

export default function SopEditor({doc, categories, sections, pages, onSaved, onCancel}) {
  const [draft, setDraft] = useState(() => toDraft(doc));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(doc?.updated_date || null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [conflict, setConflict] = useState(null);
  const fileInput = useRef(null);

  const update = (patch) => setDraft((current) => ({...current, ...patch}));
  const excludedParents = new Set([draft.id, ...descendantPages(pages, draft.id).map((page) => page.id)]);
  const parentOptions = flattenPages(pages, draft.section_id).filter((page) => !excludedParents.has(page.id) && isParentPage(pages, page.id));

  const buildRecord = () => ({
    ...(draft.id ? {id: draft.id} : {}),
    ...(draft.section_id ? {section_id: draft.section_id} : {}),
    ...(Number.isFinite(Number(draft.order)) ? {order: Number(draft.order)} : {}),
    parent_id: draft.parent_id || null,
    title: draft.title.trim(),
    category: draft.category.trim() || "General",
    summary: draft.summary.trim(),
    tags: [...new Set(draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
    content_html: draft.content_html,
    files: draft.files,
    source_url: draft.source_url.trim()
  });

  const save = async (force = false) => {
    if (!draft.title.trim()) {
      toast.error("Give the SOP a title.");
      return;
    }
    if (draft.source_url.trim() && !isSafeUrl(draft.source_url)) {
      toast.error("The SharePoint/OneNote link must start with https://");
      return;
    }
    if (uploading) {
      toast.error("Wait for the file uploads to finish.");
      return;
    }
    setSaving(true);
    let savedPage = false;
    try {
      if (!sections.some((section) => section.id === draft.section_id)) throw new Error("Choose an available destination section.");
      const [record, ...descendants] = movePageBranch(pages, buildRecord(), {sectionId: draft.section_id, parentId: draft.parent_id});
      const result = await sopsApi.save(record, {baseUpdatedAt, force});
      if (result?.reason === "conflict") {
        setConflict(result.latest || {});
        return;
      }
      savedPage = true;
      setBaseUpdatedAt(result?.record?.updated_date || baseUpdatedAt);
      update({order: record.order});
      for (const child of descendants) {
        const moved = await sopsApi.save(child, {baseUpdatedAt: child.updated_date});
        if (moved?.reason === "conflict") throw new Error(`"${child.title}" changed while moving.`);
      }
      toast.success("SOP saved");
      onSaved?.(result?.record);
    } catch (error) {
      toast.error(savedPage ? `${error.message} The page was saved, but some subpages still need moving. Save again to retry.` : error.message);
    } finally {
      setSaving(false);
    }
  };

  const reloadLatest = () => {
    if (conflict?.id) {
      setDraft(toDraft(conflict));
      setBaseUpdatedAt(conflict.updated_date || null);
    }
    setConflict(null);
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (fileInput.current) fileInput.current.value = "";
    for (const file of files) {
      const type = fileType(file);
      if (!ACCEPTED_FILE_TYPES.includes(type)) {
        toast.error(`${file.name}: use PDF, Word (.docx), images, or text files.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 20 MB.`);
        continue;
      }
      setUploading((count) => count + 1);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const uploaded = await sopsApi.uploadFile({name: file.name, type, bytes});
        if (uploaded?.fileId) {
          setDraft((current) => ({
            ...current,
            files: [...current.files.filter((item) => item.fileId !== uploaded.fileId), uploaded]
          }));
        }
      } catch (error) {
        toast.error(`${file.name}: ${error.message}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sop-section">Section</Label>
          <Select value={draft.section_id} disabled={saving} onValueChange={(sectionId) => update({section_id: sectionId, parent_id: null})}>
            <SelectTrigger id="sop-section"><SelectValue placeholder="Choose section" /></SelectTrigger>
            <SelectContent>
              {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sop-parent">Parent page</Label>
          <Select value={draft.parent_id || "__top-level"} disabled={saving} onValueChange={(parentId) => update({parent_id: parentId === "__top-level" ? null : parentId})}>
            <SelectTrigger id="sop-parent"><SelectValue placeholder="Top-level page" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__top-level">Top-level page (no parent)</SelectItem>
              {parentOptions.map((page) => <SelectItem key={page.id} value={page.id}>{`${"- ".repeat(page.depth)}${page.title}`}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Choose a parent to make this a subpage. Existing subpages move with it when you save.</p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="sop-title">Title</Label>
          <Input id="sop-title" value={draft.title} maxLength={200} onChange={(e) => update({title: e.target.value})} placeholder="e.g. Processing an RMA for a failed IQ8" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sop-category">Category</Label>
          <Input id="sop-category" list="sop-categories" value={draft.category} maxLength={60} onChange={(e) => update({category: e.target.value})} placeholder="General" />
          <datalist id="sop-categories">
            {categories.map((category) => <option key={category} value={category} />)}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sop-tags">Tags (comma separated)</Label>
          <Input id="sop-tags" value={draft.tags} onChange={(e) => update({tags: e.target.value})} placeholder="rma, warranty" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="sop-summary">Summary</Label>
          <Textarea id="sop-summary" rows={2} maxLength={500} value={draft.summary} onChange={(e) => update({summary: e.target.value})} placeholder="One or two sentences on when to use this SOP" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="sop-source">SharePoint / OneNote link (optional)</Label>
          <Input id="sop-source" value={draft.source_url} onChange={(e) => update({source_url: e.target.value})} placeholder="https://enphase.sharepoint.com/..." />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Content</Label>
        <div className="sop-editor rounded-md bg-background">
          <ReactQuill theme="snow" value={draft.content_html} onChange={(value) => update({content_html: value})} modules={QUILL_MODULES} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Attachments</Label>
          <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
            {uploading > 0 ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
            {uploading > 0 ? "Uploading..." : "Attach files"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            accept={[...ACCEPTED_FILE_TYPES, ".docx", ".txt"].join(",")}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
        {draft.files.length === 0 ? (
          <p className="text-xs text-muted-foreground">PDF, Word (.docx), images or text files up to 20 MB each.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {draft.files.map((file) => (
              <li key={file.fileId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate">{file.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => update({files: draft.files.filter((item) => item.fileId !== file.fileId)})}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => save(false)} disabled={saving || uploading > 0}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save
        </Button>
      </div>

      <AlertDialog open={Boolean(conflict)} onOpenChange={(open) => { if (!open) setConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Someone else updated this SOP</AlertDialogTitle>
            <AlertDialogDescription>
              {conflict?.updated_by ? `${conflict.updated_by} saved` : "Another person saved"} a newer version while you were editing.
              Load their version (your unsaved changes are discarded), or overwrite it with yours. Their version stays in the history either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={reloadLatest}>Load their version</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConflict(null); save(true); }}
            >
              Overwrite with mine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
