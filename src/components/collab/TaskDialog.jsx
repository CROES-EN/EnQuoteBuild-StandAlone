import {useEffect, useRef, useState} from "react";
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle} from "@/components/ui/sheet";
import {FileText, Loader2, X} from "lucide-react";
import {toast} from "sonner";
import {chatApi, tasksApi} from "@/features/collab/collabApi";
import QuotePicker, {quoteLabel} from "@/components/collab/QuotePicker";
import {createAssignedTaskRequest, sendAssignedTaskRequest} from "@/features/collab/assignedTasks";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";

export const TASK_TYPES = [
  { value: "call", label: "Call homeowner" },
  { value: "follow_up", label: "Follow up" },
  { value: "other", label: "Other" }
];

const REMINDER_OPTIONS = [
  { value: "none", label: "No reminder" },
  { value: "0", label: "At the due time" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
  { value: "custom", label: "Custom time..." }
];

// <input type="datetime-local"> works in local time without a zone; these convert both ways.
export function toLocalInput(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultDue() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function reminderChoice(task) {
  if (!task?.remind_at) return task?.id ? "none" : "0";
  const diff = Math.round((Date.parse(task.due_at) - Date.parse(task.remind_at)) / 60000);
  return ["0", "15", "60", "1440"].includes(String(diff)) ? String(diff) : "custom";
}

/**
 * Create or edit a personal task. `initial` may pre-fill fields (e.g. a quote link when opened
 * from a quote's "Add call reminder" button).
 */
export default function TaskDialog({ open, onOpenChange, task, initial, presentation = "dialog", allowAssignment = false }) {
  const [form, setForm] = useState({});
  const [reminder, setReminder] = useState("0");
  const [customRemind, setCustomRemind] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [people, setPeople] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [sendError, setSendError] = useState("");
  const sending = useRef(false);
  const pending = useRef(null);
  const owner = useRef(getCurrentUserNamespace());
  const panel = presentation === "panel";
  const canAssign = allowAssignment && !task;
  const locked = saving || Boolean(pendingRequest);

  useEffect(() => {
    if (!open || !canAssign) return;
    let cancelled = false;
    setPeople([]);
    setDirectoryLoading(true);
    setDirectoryError("");
    chatApi.directory().then(users => {
      if (!cancelled) setPeople(users.filter(person => person.email !== getCurrentUserNamespace()));
    }).catch(error => {
      if (!cancelled) setDirectoryError(error.message);
    }).finally(() => {
      if (!cancelled) setDirectoryLoading(false);
    });
    return () => {cancelled = true;};
  }, [open, canAssign, directoryRetry]);

  useEffect(() => {
    if (!open) return;
    const base = { type: "call", title: "", notes: "", due_at: defaultDue(), quote_id: null, quote_label: null, site_id: "", case_number: "", contact_name: "", contact_phone: "", ...initial, ...task };
    setForm({ ...base, due_local: toLocalInput(base.due_at) });
    setReminder(reminderChoice(task || (initial?.remind_at ? initial : null)));
    setCustomRemind(task?.remind_at ? toLocalInput(task.remind_at) : "");
    setRecipient("");
    setPendingRequest(null);
    pending.current = null;
    setSendError("");
  }, [open, task, initial]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  async function handleSave() {
    if (sending.current) return;
    if (recipient && !canAssign) {
      const message = "Messages access is required to send this task. Close the panel and reopen it to create a personal task.";
      setSendError(message);
      return toast.error(message);
    }
    const dueAt = fromLocalInput(form.due_local);
    if (!form.title?.trim()) return toast.error("Give the task a title.");
    if (!dueAt) return toast.error("Pick a due date and time.");
    let remindAt = null;
    if (reminder === "custom") {
      remindAt = fromLocalInput(customRemind);
      if (!remindAt) return toast.error("Pick a reminder time.");
    } else if (reminder !== "none") {
      remindAt = new Date(Date.parse(dueAt) - Number(reminder) * 60000).toISOString();
    }
    const rest = { ...form };
    delete rest.due_local;
    const changedReminder = remindAt !== (task?.remind_at || null) || dueAt !== task?.due_at;
    const record = {
      ...rest,
      title: form.title.trim(),
      site_id: String(form.site_id || "").trim(),
      case_number: String(form.case_number || "").trim(),
      ...(String(form.case_number || "").trim() !== String((task || initial)?.case_number || "").trim() ? {case_id: null} : {}),
      due_at: dueAt,
      remind_at: remindAt,
      ...(changedReminder ? { snoozed_until: null } : {})
    };
    setSaving(true);
    sending.current = true;
    setSendError("");
    try {
      if (recipient && canAssign) {
        if (!pending.current) {
          const conversation = await chatApi.openDm(recipient);
          if (owner.current !== getCurrentUserNamespace()) return;
          const request = createAssignedTaskRequest({conversationId: conversation?.id, recipient,
            title: record.title, notes: record.notes || "", dueLocal: form.due_local, task: record});
          pending.current = request;
          setPendingRequest(request);
        }
        await sendAssignedTaskRequest(pending.current);
      } else {
        await tasksApi.save(record);
      }
      if (owner.current !== getCurrentUserNamespace()) return;
      toast.success(recipient ? "Task sent. It will appear in your teammate's Tasks after sync." : task ? "Task updated" : "Task added");
      onOpenChange(false);
    } catch (error) {
      if (owner.current === getCurrentUserNamespace()) {
        setSendError(error.message);
        toast.error(error.message);
      }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  const Root = panel ? Sheet : Dialog;
  const Content = panel ? SheetContent : DialogContent;
  const Header = panel ? SheetHeader : DialogHeader;
  const Title = panel ? SheetTitle : DialogTitle;
  const Footer = panel ? SheetFooter : DialogFooter;
  return (
    <Root open={open} modal={!panel} onOpenChange={value => {if (!sending.current) onOpenChange(value);}}>
      <Content
        {...(panel ? {side: "right", overlay: false, closeDisabled: saving,
          onInteractOutside: event => event.preventDefault()} : {})}
        aria-describedby={undefined}
        className={panel ? "top-4 bottom-auto right-4 flex h-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-3 overflow-y-auto rounded-xl p-4 sm:max-w-[420px]" : "max-w-lg max-h-[90vh] overflow-y-auto"}>
        <Header>
          <Title>{task ? "Edit task" : "New task"}</Title>
        </Header>
        <fieldset disabled={locked} className={panel ?
          "min-w-0 space-y-2.5 border-0 p-0 [&_input]:h-8 [&_label]:text-xs [&_button[role=combobox]]:h-8" :
          "min-w-0 space-y-4 border-0 p-0"}>
          {canAssign && <div className="space-y-1.5">
            <Label htmlFor="task-recipient">Task for</Label>
            <select id="task-recipient" value={recipient} onChange={event => setRecipient(event.target.value)}
              className={`${panel ? "h-8" : "h-10"} w-full rounded-md border border-input bg-background px-3 text-sm`}>
              <option value="">For me</option>
              {people.map(person => <option key={person.email} value={person.email}>{person.display_name || person.name || person.email}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{directoryLoading ? "Loading teammates..." : recipient ?
              "Delivered to their private Tasks list, with a confirmation in your direct conversation." : "Saved to your private Tasks list."}</p>
            {directoryError && <div role="alert" className="text-sm text-destructive">
              {directoryError} <Button type="button" variant="link" onClick={() => setDirectoryRetry(value => value + 1)}>Retry loading teammates</Button>
            </div>}
          </div>}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={form.title || ""} maxLength={200} onChange={(event) => set({ title: event.target.value })} placeholder="e.g. Call homeowner about approval" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type || "call"} onValueChange={(value) => set({ type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due</Label>
              <Input id="task-due" type="datetime-local" value={form.due_local || ""} onChange={(event) => set({ due_local: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reminder</Label>
              <Select value={reminder} onValueChange={setReminder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {reminder === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="task-remind">Remind me at</Label>
              <Input id="task-remind" type="datetime-local" value={customRemind} onChange={(event) => setCustomRemind(event.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Quote</Label>
            {form.quote_id ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{form.quote_label || "Linked quote"}</span>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => set({ quote_id: null, quote_label: null })} title="Remove quote link">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-start text-muted-foreground">
                    <FileText className="mr-2 h-4 w-4" />Link a quote (optional)
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-2" align="start">
                  <QuotePicker onPick={(quote) => { set({ quote_id: String(quote.id), quote_label: quoteLabel(quote) }); setPickerOpen(false); }} />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-site-id">Site ID</Label>
              <Input id="task-site-id" value={form.site_id || ""} maxLength={100} onChange={(event) => set({site_id: event.target.value})} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-case-number">Case Number</Label>
              <Input id="task-case-number" value={form.case_number || ""} maxLength={100} onChange={(event) => set({case_number: event.target.value})} placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-contact">Contact name</Label>
              <Input id="task-contact" value={form.contact_name || ""} maxLength={120} onChange={(event) => set({ contact_name: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-phone">Phone</Label>
              <Input id="task-phone" value={form.contact_phone || ""} maxLength={40} onChange={(event) => set({ contact_phone: event.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea id="task-notes" rows={panel ? 2 : 3} value={form.notes || ""} maxLength={4000} onChange={(event) => set({ notes: event.target.value })} />
          </div>
        </fieldset>
        {sendError && <div role="alert" className="text-sm text-destructive">
          <p>{sendError}</p>
          {pendingRequest && <p>Retry uses the same request ID to avoid duplicates. Fields stay locked until this assignment is resolved or closed.</p>}
        </div>}
        <Footer className={panel ? "mt-4" : undefined}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-orange-600 hover:bg-orange-700 text-white">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pendingRequest ? "Retry assignment" : recipient ? "Send task" : task ? "Save" : "Add task"}
          </Button>
        </Footer>
      </Content>
    </Root>
  );
}
