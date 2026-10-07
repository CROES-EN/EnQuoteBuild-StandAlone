import {useEffect, useRef, useState} from "react";
import {toast} from "sonner";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {chatApi} from "@/features/collab/collabApi";
import {createCaseTaskRequest, sendCaseTaskRequest} from "@/features/collab/caseTasks";

export default function CaseTagDialog({row, onClose}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [reload, setReload] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [request, setRequest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sendError, setSendError] = useState("");
  const sending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDirectoryError("");
    Promise.all([chatApi.directory(), chatApi.me()])
      .then(([directory, me]) => {
        if (!cancelled) setUsers(directory.filter((person) => person.email !== me?.email));
      })
      .catch((error) => { if (!cancelled) setDirectoryError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  async function send(event) {
    event.preventDefault();
    if (sending.current) return;
    let pending;
    try {
      pending = request || createCaseTaskRequest({row, recipient, note, dueLocal});
    } catch (error) {
      toast.error(error.message);
      return;
    }
    sending.current = true;
    setSaving(true);
    setRequest(pending);
    setSendError("");
    try {
      await sendCaseTaskRequest(pending);
      toast.success("Tagged teammate. Their task will appear when EnQuote syncs.");
      onClose();
    } catch (error) {
      setSendError(error.message);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !sending.current) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag someone on case {row["Case Number"]}</DialogTitle>
          <DialogDescription>Creates a task for your teammate and sends them a message. Report refreshes do not remove the task.</DialogDescription>
        </DialogHeader>
        {directoryError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{directoryError}</p>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Retry directory</Button>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="case-tag-person">Teammate</Label>
              <select id="case-tag-person" required value={recipient} onChange={(event) => setRecipient(event.target.value)}
                disabled={loading || Boolean(request)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">{loading ? "Loading teammates..." : "Choose a teammate"}</option>
                {users.map((person) => <option key={person.email} value={person.email}>{person.name} ({person.email})</option>)}
              </select>
              {!loading && !users.length && <p role="status" className="text-sm text-muted-foreground">No teammates are available in the directory.</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="case-tag-due">Due date and time (required)</Label>
              <Input id="case-tag-due" type="datetime-local" required value={dueLocal}
                disabled={Boolean(request)} onChange={(event) => setDueLocal(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="case-tag-note">Note (optional)</Label>
              <Textarea id="case-tag-note" value={note} maxLength={2000} disabled={Boolean(request)}
                onChange={(event) => setNote(event.target.value)} />
            </div>
            {sendError && <div role="alert" className="text-sm text-destructive">
              <p>{sendError}</p>
              <p>Retry keeps the same request ID to prevent duplicate tasks. Fields are locked until this request is resolved.</p>
            </div>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button>
              <Button type="submit" disabled={saving || loading || !users.length}>
                {saving ? "Sending..." : request ? "Retry tag" : "Tag and create task"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
