import {useEffect, useRef, useState} from "react";
import {FileUp, Loader2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {sopsApi, subscribe} from "@/features/collab/collabApi";
import {formatBytes} from "./SopFilePreview";

export default function SopOneNoteImport({sections, selectedSectionId, onImported}) {
  const [previews, setPreviews] = useState(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [destinationLocked, setDestinationLocked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [progress, setProgress] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const pendingSessions = useRef(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const off = subscribe("sops", "onOneNoteProgress", (value) => {
      if (value.stage === "reading" || pendingSessions.current.has(value.sessionId)) setProgress(value);
    });
    const pending = pendingSessions.current;
    return () => {
      mounted.current = false;
      off();
      pending.forEach((id) => void sopsApi.cancelOneNote(id).catch((error) => toast.error(error.message)));
      pending.clear();
    };
  }, []);

  const prepare = async () => {
    setReading(true);
    setProgress(null);
    try {
      const result = await sopsApi.prepareOneNote();
      if (result.cancelled) return;
      const loaded = result.previews || [result];
      if (!mounted.current) {
        await Promise.all(loaded.map((preview) => sopsApi.cancelOneNote(preview.sessionId)));
        return;
      }
      loaded.forEach((preview) => pendingSessions.current.add(preview.sessionId));
      setPreviews(loaded.map((preview) => ({...preview, imported: false})));
      setSectionId(selectedSectionId || "");
      setDestinationLocked(false);
      setAccepted(false);
      setProgress(null);
      setErrorMessage("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      if (mounted.current) setReading(false);
    }
  };

  const close = async () => {
    if (importing) return;
    try {
      await Promise.all([...pendingSessions.current].map((id) => sopsApi.cancelOneNote(id)));
      pendingSessions.current.clear();
      if (previews.some((preview) => preview.imported)) toast.info("Sections that already finished importing were kept.");
      setPreviews(null);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const startImport = async () => {
    setImporting(true);
    setErrorMessage("");
    setDestinationLocked(true);
    let last = null;
    let pages = 0;
    try {
      for (const preview of previews) {
        if (preview.imported) continue;
        const result = await sopsApi.importOneNote({sessionId: preview.sessionId, sectionId: sectionId || null});
        pendingSessions.current.delete(preview.sessionId);
        pages += result.imported;
        last = result;
        if (mounted.current) setPreviews((current) => current.map((item) => item.sessionId === preview.sessionId ? {...item, imported: true} : item));
      }
      if (mounted.current) {
        setPreviews(null);
        if (last) onImported(last.sectionId, last.parentPageId);
      }
      toast.success(previews.length > 1 ? `Imported ${previews.length} OneNote sections` : `Imported ${pages} OneNote pages`);
    } catch (error) {
      if (mounted.current) setErrorMessage(error.message);
      toast.error(error.message);
    } finally {
      if (mounted.current) setImporting(false);
    }
  };

  const multiple = previews?.length > 1;
  const totalPages = previews?.reduce((sum, preview) => sum + preview.pages.length, 0) || 0;
  const totalBytes = previews?.reduce((sum, preview) => sum + preview.totalBytes, 0) || 0;
  const destinationText = sectionId
    ? multiple
      ? "Creates one parent page per OneNote section in this section, each with its imported pages nested underneath."
      : `Creates a parent page named "${previews?.[0]?.title}" in this section, with all imported pages nested underneath.`
    : multiple
      ? "Creates a new EnQuote section for each OneNote section."
      : `Creates a new section named "${previews?.[0]?.title}".`;

  return (
    <>
      <Button variant="outline" onClick={prepare} disabled={reading || importing || Boolean(previews)} aria-label="Import OneNote section">
        {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
        {reading ? (progress?.stage === "reading" && progress.total > 1 ? `Reading ${progress.completed + 1} of ${progress.total}...` : "Reading OneNote...") : "Import OneNote"}
      </Button>
      <Dialog open={Boolean(previews)} onOpenChange={(open) => { if (!open) void close(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import OneNote {multiple ? "sections" : "section"}</DialogTitle>
            <DialogDescription>Import .one exports under an existing EnQuote section as parent pages, or as new sections. Existing content is not overwritten.</DialogDescription>
          </DialogHeader>
          {previews && (
            <>
              <div className="space-y-2">
                {multiple ? (
                  <>
                    <p className="font-medium">{previews.length} OneNote sections</p>
                    <ul className="space-y-1 text-sm" aria-label="OneNote sections to import">
                      {previews.map((preview) => (
                        <li key={preview.sessionId} className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words">{preview.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{preview.imported ? "Imported" : `${preview.pages.length} pages`}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="font-medium">{previews[0].title}</p>
                )}
                <p className="text-sm text-muted-foreground">{totalPages} pages, {formatBytes(totalBytes)} of PDF snapshots</p>
                <Label htmlFor="onenote-section">Destination section</Label>
                <Select value={sectionId || "__new-section"} onValueChange={(id) => setSectionId(id === "__new-section" ? "" : id)} disabled={importing || destinationLocked}>
                  <SelectTrigger id="onenote-section"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>)}
                    <SelectItem value="__new-section">Create a new section</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{destinationText}</p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {previews[0].warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
              <details className="rounded-md border p-2 text-sm">
                <summary className="cursor-pointer">Pages and conversion notes</summary>
                {previews.map((preview) => (
                  <div key={preview.sessionId} className="mt-2">
                    {multiple && <p className="break-words font-semibold">{preview.title}</p>}
                    <ul className="mt-1 space-y-2">
                      {preview.pages.map((page) => (
                        <li key={page.id} style={{paddingLeft: `${page.depth}rem`}}>
                          <span className="break-words font-medium">{page.title}</span>
                          <ul className="text-xs text-muted-foreground">{page.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
              <div className="flex items-start gap-2">
                <Checkbox id="onenote-accept" checked={accepted} disabled={importing} onCheckedChange={(value) => setAccepted(value === true)} />
                <Label htmlFor="onenote-accept" className="leading-normal">I understand the conversion limits and that these pages will be shared in the SOP Library.</Label>
              </div>
              {progress && progress.stage !== "reading" && (
                <p role="status" className="text-sm">
                  {multiple ? `Section ${previews.filter((preview) => preview.imported).length + 1} of ${previews.length}: ` : ""}
                  {progress.completed} / {progress.total} pages imported{progress.title ? `: ${progress.title}` : ""}
                </p>
              )}
              {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
              <DialogFooter>
                <Button variant="outline" disabled={importing} onClick={close}>Cancel</Button>
                <Button disabled={importing || !accepted} onClick={startImport}>
                  {importing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {importing ? "Importing..." : errorMessage ? "Retry import" : multiple ? `Import ${previews.length} sections` : "Import section"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
