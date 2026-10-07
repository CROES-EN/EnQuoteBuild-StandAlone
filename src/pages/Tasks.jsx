import {useEffect, useMemo, useState} from "react";
import {Link, useLocation} from "react-router-dom";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "date-fns";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Checkbox} from "@/components/ui/checkbox";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import QuoteAttentionSection from "@/components/tasks/QuoteAttentionSection";
import {useAuth} from "@/lib/AuthContext";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {
  AlarmClock,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Trash2
} from "lucide-react";
import {toast} from "sonner";
import {createPageUrl} from "@/utils";
import {cn} from "@/lib/utils";
import {tasksApi, useTasks} from "@/features/collab/collabApi";
import TaskDialog, {TASK_TYPES} from "@/components/collab/TaskDialog";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";

const typeLabel = (type) => TASK_TYPES.find((item) => item.value === type)?.label || "Task";

function groupTasks(tasks, now) {
  const todayEnd = addDays(startOfDay(now), 1).getTime();
  const groups = { overdue: [], today: [], upcoming: [], done: [] };
  for (const task of tasks) {
    const due = Date.parse(task.due_at || "");
    if (task.status === "done") groups.done.push(task);
    else if (due < now.getTime()) groups.overdue.push(task);
    else if (due < todayEnd) groups.today.push(task);
    else groups.upcoming.push(task);
  }
  const byDue = (a, b) => String(a.due_at).localeCompare(String(b.due_at));
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.done.sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")));
  return groups;
}

function snoozeTimes(now) {
  const tomorrow = addDays(startOfDay(now), 1);
  tomorrow.setHours(9);
  return [
    { label: "15 minutes", at: new Date(now.getTime() + 15 * 60000) },
    { label: "1 hour", at: new Date(now.getTime() + 60 * 60000) },
    { label: "3 hours", at: new Date(now.getTime() + 3 * 60 * 60000) },
    { label: "Tomorrow 9:00 AM", at: tomorrow }
  ];
}

async function saveQuietly(task, patch, message) {
  try {
    await tasksApi.save({ ...task, ...patch });
    if (message) toast.success(message);
  } catch (error) {
    toast.error(error.message);
  }
}

function TaskRow({ task, now, highlightedId, onEdit }) {
  const highlighted = Boolean(highlightedId) && task.id === highlightedId;
  const due = new Date(task.due_at);
  const done = task.status === "done";
  const overdue = !done && due < now;
  const reminderAt = task.snoozed_until || task.remind_at;
  const reminderFired = !done && reminderAt && Date.parse(reminderAt) <= now.getTime();

  async function handleDelete() {
    try {
      await tasksApi.delete(task.id);
      toast.success("Task deleted", {
        action: { label: "Undo", onClick: () => saveQuietly(task, {}, null) }
      });
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <div
      id={`task-${task.id}`}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors",
        highlighted && "ring-2 ring-orange-500",
        reminderFired && "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={done}
        onCheckedChange={(checked) => saveQuietly(task, { status: checked ? "done" : "open" }, checked ? "Marked done" : null)}
        aria-label={done ? "Mark as not done" : "Mark as done"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium text-foreground", done && "text-muted-foreground line-through")}>{task.title}</span>
          <Badge variant="outline" className="text-xs">{typeLabel(task.type)}</Badge>
          {task.site_id && <span>Site <SiteIdLink siteId={task.site_id} /></span>}
          {task.case_number && <CaseNumberLink caseNumber={task.case_number} caseId={task.case_id}>
            Case {task.case_number}
          </CaseNumberLink>}
          {task.quote_id && (
            <Link to={createPageUrl(`QuoteDetails?id=${task.quote_id}`)} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent">
              <FileText className="h-3 w-3" />{task.quote_label || "Quote"}
            </Link>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className={cn(overdue && "font-semibold text-red-600")}>
            {overdue ? "Overdue \u00b7 " : ""}{format(due, "EEE MMM d, h:mm a")}
          </span>
          {!done && reminderAt && (
            <span className={cn("inline-flex items-center gap-1", reminderFired && "font-semibold text-orange-600")}>
              <Bell className="h-3 w-3" />
              {task.snoozed_until ? "Snoozed until " : "Reminder "}{format(new Date(reminderAt), "MMM d, h:mm a")}
            </span>
          )}
          {(task.contact_name || task.contact_phone) && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {[task.contact_name, task.contact_phone].filter(Boolean).join(" \u00b7 ")}
            </span>
          )}
          {done && task.completed_at && <span>Done {format(new Date(task.completed_at), "MMM d, h:mm a")}</span>}
        </div>
        {task.assigned_by && <p className="mt-1 text-xs text-muted-foreground">Tagged by {task.assigned_by}</p>}
        {task.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.notes}</p>}
      </div>
      <div className="flex items-center gap-1">
        {!done && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" title="Snooze"><AlarmClock className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {snoozeTimes(new Date()).map((option) => (
                <DropdownMenuItem key={option.label} onClick={() => saveQuietly(task, { snoozed_until: option.at.toISOString(), notified_at: null }, `Snoozed until ${format(option.at, "MMM d, h:mm a")}`)}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" title="More"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(task)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TaskSection({ title, tasks, tone, ...rowProps }) {
  if (!tasks.length) return null;
  return (
    <section className="space-y-2">
      <h2 className={cn("text-sm font-semibold uppercase tracking-wide text-muted-foreground", tone)}>
        {title} <span className="font-normal">({tasks.length})</span>
      </h2>
      {tasks.map((task) => <TaskRow key={task.id} task={task} {...rowProps} />)}
    </section>
  );
}

function CalendarView({ tasks, now, onEdit, onAdd, highlightedId }) {
  const [month, setMonth] = useState(() => startOfMonth(now));
  const [selected, setSelected] = useState(() => startOfDay(now));
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) });
  const tasksByDay = useMemo(() => {
    const map = new Map();
    for (const task of tasks) {
      if (task.status === "done") continue;
      const key = format(new Date(task.due_at), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    for (const list of map.values()) list.sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
    return map;
  }, [tasks]);
  const selectedTasks = tasksByDay.get(format(selected, "yyyy-MM-dd")) || [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setMonth((value) => addMonths(value, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{format(month, "MMMM yyyy")}</span>
              <Button variant="outline" size="sm" onClick={() => { setMonth(startOfMonth(new Date())); setSelected(startOfDay(new Date())); }}>Today</Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMonth((value) => addMonths(value, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="bg-muted px-2 py-1 text-center font-medium text-muted-foreground">{day}</div>
            ))}
            {days.map((day) => {
              const dayTasks = tasksByDay.get(format(day, "yyyy-MM-dd")) || [];
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "min-h-[84px] bg-card p-1.5 text-left align-top hover:bg-accent",
                    !isSameMonth(day, month) && "bg-muted/40 text-muted-foreground",
                    isSameDay(day, selected) && "ring-2 ring-inset ring-orange-500"
                  )}
                >
                  <div className={cn("mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px]", isToday(day) && "bg-orange-600 font-semibold text-white")}>
                    {format(day, "d")}
                  </div>
                  {dayTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className={cn("mb-0.5 truncate rounded px-1 py-0.5 text-[11px]", new Date(task.due_at) < now ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" : "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200")}>
                      {format(new Date(task.due_at), "h:mma").toLowerCase()} {task.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && <div className="text-[11px] text-muted-foreground">+{dayTasks.length - 3} more</div>}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{format(selected, "EEEE, MMMM d")}</h2>
          <Button size="sm" variant="outline" onClick={() => onAdd(selected)}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
        {selectedTasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing due this day.</p>
        ) : selectedTasks.map((task) => <TaskRow key={task.id} task={task} now={now} onEdit={onEdit} highlightedId={highlightedId} />)}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { tasks, loading } = useTasks();
  const location = useLocation();
  const { user } = useAuth();
  const highlightedId = new URLSearchParams(location.search).get("task");
  const [now, setNow] = useState(() => new Date());
  const [dialog, setDialog] = useState({ open: false, task: null, initial: null });
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    void tasksApi.syncNow();
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!highlightedId || loading) return;
    document.getElementById(`task-${highlightedId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightedId, loading]);

  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now]);
  const openCount = groups.overdue.length + groups.today.length + groups.upcoming.length;
  const openEdit = (task) => setDialog({ open: true, task, initial: null });
  const openNew = (day) => {
    let initial = null;
    if (day) {
      const due = new Date(day);
      due.setHours(9, 0, 0, 0);
      initial = { due_at: due.toISOString() };
    }
    setDialog({ open: true, task: null, initial });
  };
  const rowProps = { now, onEdit: openEdit, highlightedId };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><ClipboardList className="h-6 w-6 text-orange-600" />Tasks</h1>
          <p className="text-sm text-muted-foreground">Your private call-backs, reminders, and cases tagged by teammates.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Overdue", value: groups.overdue.length, tone: "text-red-600" },
          { label: "Due today", value: groups.today.length, tone: "text-orange-600" },
          { label: "Upcoming", value: groups.upcoming.length, tone: "text-foreground" }
        ].map((stat) => (
          <Card key={stat.label}><CardContent className="p-4"><div className={cn("text-2xl font-bold", stat.tone)}>{stat.value}</div><div className="text-xs text-muted-foreground">{stat.label}</div></CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="list">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="list"><ListTodo className="mr-1.5 h-4 w-4" />List</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="mr-1.5 h-4 w-4" />Calendar</TabsTrigger>
          <TabsTrigger value="quote-attention"><FileText className="mr-1.5 h-4 w-4" />Quotes needing attention</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-4 space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tasks...</p>
          ) : openCount === 0 && !groups.done.length ? (
            <Card><CardContent className="p-10 text-center">
              <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No tasks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add a call-back from any quote with "Add call reminder", or create one here.</p>
            </CardContent></Card>
          ) : (
            <>
              {openCount === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>}
              <TaskSection title="Overdue" tasks={groups.overdue} tone="text-red-600" {...rowProps} />
              <TaskSection title="Today" tasks={groups.today} {...rowProps} />
              <TaskSection title="Upcoming" tasks={groups.upcoming} {...rowProps} />
              {groups.done.length > 0 && (
                <div className="space-y-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowDone((value) => !value)}>
                    {showDone ? "Hide" : "Show"} completed ({groups.done.length})
                  </Button>
                  {showDone && groups.done.slice(0, 100).map((task) => <TaskRow key={task.id} task={task} {...rowProps} />)}
                </div>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <CalendarView tasks={tasks} now={now} onEdit={openEdit} onAdd={openNew} highlightedId={highlightedId} />
        </TabsContent>
        <TabsContent value="quote-attention" className="mt-4">
          <QuoteAttentionSection userEmail={user?.email} now={now} />
        </TabsContent>
      </Tabs>

      <TaskDialog open={dialog.open} onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))} task={dialog.task} initial={dialog.initial} />
    </div>
  );
}
