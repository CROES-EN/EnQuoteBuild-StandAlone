import {useEffect, useState} from "react";
import DOMPurify from "dompurify";
import {Download, FileText, Loader2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {sopsApi} from "@/features/collab/collabApi";

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  DOCX_TYPE,
  "text/plain"
];

export function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Downloads (from the local cache when possible) and renders one attached SOP file inline.
export default function SopFilePreview({file}) {
  const [state, setState] = useState({status: "loading"});

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setState({status: "loading"});
    (async () => {
      try {
        const result = await sopsApi.getFile(file.fileId, {name: file.name, type: file.type});
        const bytes = result?.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result?.bytes || []);
        const type = file.type || result?.type || "application/octet-stream";
        objectUrl = URL.createObjectURL(new Blob([bytes], {type}));
        let html = null;
        let text = null;
        if (type === DOCX_TYPE) {
          const mammoth = await import("mammoth");
          const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          const converted = await mammoth.convertToHtml({arrayBuffer});
          html = DOMPurify.sanitize(converted.value || "");
        } else if (type === "text/plain") {
          text = new TextDecoder().decode(bytes);
        }
        if (!cancelled) setState({status: "ready", url: objectUrl, type, html, text});
      } catch (error) {
        if (!cancelled) setState({status: "error", message: error?.message || "Couldn't open this file."});
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.fileId, file.name, file.type]);

  let body;
  if (state.status === "loading") {
    body = (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading file...
      </div>
    );
  } else if (state.status === "error") {
    body = <p className="px-3 py-6 text-sm text-destructive">{state.message}</p>;
  } else if (state.type.startsWith("image/")) {
    body = <img src={state.url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full object-contain p-2" />;
  } else if (state.type === "application/pdf") {
    body = <iframe src={state.url} title={file.name} className="h-[75vh] w-full border-0" />;
  } else if (state.html !== null) {
    body = <div className="sop-content max-h-[75vh] overflow-auto px-4 py-3" dangerouslySetInnerHTML={{__html: state.html}} />;
  } else if (state.text !== null) {
    body = <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap px-4 py-3 text-sm text-foreground">{state.text}</pre>;
  } else {
    body = <p className="px-3 py-6 text-sm text-muted-foreground">This file can't be previewed. Use "Save copy" to open it.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{file.name}</span>
          <span className="flex-shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        </div>
        {state.status === "ready" && (
          <Button asChild size="sm" variant="ghost">
            <a href={state.url} download={file.name}>
              <Download className="mr-1 h-4 w-4" /> Save copy
            </a>
          </Button>
        )}
      </div>
      {body}
    </div>
  );
}
