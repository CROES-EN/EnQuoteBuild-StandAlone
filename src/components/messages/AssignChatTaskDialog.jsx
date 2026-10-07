import {useRef, useState} from "react";
import {toast} from "sonner";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {displayName} from "./ConversationDialogs";
import {createAssignedTaskRequest, sendAssignedTaskRequest} from "@/features/collab/assignedTasks";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";

export default function AssignChatTaskDialog({conversation, meEmail, names, onClose}) {
  const people = (conversation.members || []).filter(member => member.email !== meEmail);
  const [recipient, setRecipient] = useState(() => conversation.kind === "dm" ? people[0]?.email || "" : "");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [request, setRequest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (sending.current) return;
    let pending;
    try {pending = request || createAssignedTaskRequest({conversationId: conversation.id, recipient, title, notes, dueLocal});}
    catch (error) {setError(error.message); return;}
    const owner = getCurrentUserNamespace();
    setRequest(pending);
    setError("");
    setSaving(true);
    sending.current = true;
    try {
      await sendAssignedTaskRequest(pending);
      if (owner !== getCurrentUserNamespace()) return;
      toast.success("Task assigned. It will appear in your teammate's Tasks after sync.");
      onClose();
    } catch (error) {
      if (owner === getCurrentUserNamespace()) setError(error.message);
    } finally {sending.current = false; setSaving(false);}
  };
  return <Dialog open onOpenChange={open => {if (!open && !sending.current) onClose();}}>
    <DialogContent>
      <DialogHeader><DialogTitle>Assign a task</DialogTitle><DialogDescription>Creates a personal task for a teammate and posts the assignment in this conversation.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1"><Label htmlFor="chat-task-person">Teammate</Label>
          <select id="chat-task-person" required value={recipient} disabled={Boolean(request)} onChange={event => setRecipient(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Choose a teammate</option>
            {people.map(person => <option key={person.email} value={person.email}>{displayName(person.email, names)}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="chat-task-title">Task title</Label><Input id="chat-task-title" required maxLength={200} value={title} disabled={Boolean(request)} onChange={event => setTitle(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="chat-task-due">Due date and time</Label><Input id="chat-task-due" required type="datetime-local" value={dueLocal} disabled={Boolean(request)} onChange={event => setDueLocal(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="chat-task-notes">Notes (optional)</Label><Textarea id="chat-task-notes" maxLength={2000} value={notes} disabled={Boolean(request)} onChange={event => setNotes(event.target.value)} /></div>
        {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p>{request && <p>Retry uses the same request ID. Fields stay locked to prevent duplicate assignments.</p>}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Close</Button><Button type="submit" disabled={saving || !people.length}>{saving ? "Assigning..." : request ? "Retry assignment" : "Assign task"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
