import {useEffect, useState} from "react";
import DOMPurify from "dompurify";
import {format} from "date-fns";
import {History, Loader2, RotateCcw} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {sopsApi} from "@/features/collab/collabApi";
import {cn} from "@/lib/utils";

function formatStamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? format(time, "MMM d, yyyy h:mm a") : "Unknown time";
}

export default function SopHistoryDialog({doc, open, onOpenChange, onRestored}) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open || !doc?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    sopsApi.versions(doc.id)
      .then((items) => {
        if (cancelled) return;
        setVersions(items);
        setSelected(items.find((item) => !item.deleted && item.record) || null);
      })
      .catch((error) => { if (!cancelled) toast.error(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, doc?.id]);

  const restore = async () => {
    if (!selected?.record) return;
    setRestoring(true);
    try {
      const result = await sopsApi.save({...selected.record, id: doc.id}, {force: true});
      toast.success(`Restored the version from ${formatStamp(selected.version)}`);
      onRestored?.(result?.record);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Version history</DialogTitle>
          <DialogDescription>{doc?.title}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history...
          </div>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No earlier versions are available.</p>
        ) : (
          <div className="grid max-h-[65vh] gap-4 md:grid-cols-[240px_1fr]">
            <ul className="space-y-1 overflow-y-auto pr-1">
              {versions.map((version, index) => (
                <li key={version.version}>
                  <button
                    type="button"
                    onClick={() => setSelected(version)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected?.version === version.version ? "border-orange-300 bg-orange-50" : "border-transparent hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium text-slate-700">
                      {formatStamp(version.version)}
                      {index === 0 && <Badge variant="secondary">Current</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {version.deleted ? "Deleted by " : "Saved by "}{version.updatedBy || "unknown"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-col rounded-md border border-slate-200">
              {selected?.record ? (
                <>
                  <div className="overflow-y-auto p-4">
                    <h3 className="text-lg font-semibold text-slate-800">{selected.record.title}</h3>
                    {selected.record.summary && <p className="mt-1 text-sm text-slate-600">{selected.record.summary}</p>}
                    <div
                      className="sop-content mt-3"
                      dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(selected.record.content_html || "")}}
                    />
                    {(selected.record.files || []).length > 0 && (
                      <p className="mt-3 text-xs text-slate-500">
                        Attachments: {selected.record.files.map((file) => file.name).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end border-t border-slate-200 p-3">
                    <Button onClick={restore} disabled={restoring} className="bg-orange-600 hover:bg-orange-700">
                      {restoring ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                      Restore this version
                    </Button>
                  </div>
                </>
              ) : (
                <p className="p-6 text-sm text-slate-500">Pick a version to preview it.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
