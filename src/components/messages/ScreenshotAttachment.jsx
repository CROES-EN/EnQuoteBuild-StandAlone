import {useEffect, useState} from "react";
import {chatApi} from "@/features/collab/collabApi";
import {Button} from "@/components/ui/button";

export default function ScreenshotAttachment({attachment, conversationId}) {
  const [source, setSource] = useState(attachment.dataUrl || "");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attachment.dataUrl) return undefined;
    let cancelled = false;
    setSource("");
    setError("");
    chatApi.getImage({conversationId, fileId: attachment.fileId}).then(dataUrl => {
      if (!dataUrl) throw new Error("The screenshot response was empty.");
      if (!cancelled) setSource(dataUrl);
    }).catch(error => {
      console.error("Could not load chat screenshot", error);
      if (!cancelled) setError(error.message);
    });
    return () => { cancelled = true; };
  }, [attachment.dataUrl, attachment.fileId, conversationId, attempt]);
  if (error) return (
    <div role="alert" className="rounded border border-border bg-card p-2 text-sm text-card-foreground">
      {error} <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button>
    </div>
  );
  if (!source) return <p role="status" className="text-sm">Loading screenshot...</p>;
  return <img src={source} alt={attachment.name || "Screenshot"} className="max-h-96 max-w-full rounded-lg border border-border object-contain" />;
}
