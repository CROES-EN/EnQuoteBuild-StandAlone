import {useEffect, useMemo, useState} from "react";
import {Loader2, LogOut, Search, UserPlus, Users} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {chatApi} from "@/features/collab/collabApi";
import {UserAvatar} from "@/components/profile/UserAvatar";

export function displayName(email, names) {
  const key = String(email || "").toLowerCase();
  return names.get(key) || key.split("@")[0] || "Unknown";
}

function PeopleList({people, names, selected, onToggle, single = false, onPick}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return people.filter((person) => !term || person.email.includes(term) || displayName(person.email, names).toLowerCase().includes(term));
  }, [people, names, search]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" className="pl-8" />
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No one matches.</li>}
        {visible.map((person) => (
          <li key={person.email}>
            {single ? (
              <button type="button" onClick={() => onPick(person.email)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-foreground hover:bg-muted">
                <UserAvatar email={person.email} name={displayName(person.email, names)} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{displayName(person.email, names)}</span>
                  <span className="truncate text-xs text-slate-500">{person.email}</span>
                </span>
              </button>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-foreground hover:bg-muted">
                <Checkbox checked={selected.has(person.email)} onCheckedChange={(checked) => onToggle(person.email, checked === true)} />
                <UserAvatar email={person.email} name={displayName(person.email, names)} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{displayName(person.email, names)}</span>
                  <span className="truncate text-xs text-slate-500">{person.email}</span>
                </span>
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useToggleSet(open) {
  const [items, setItems] = useState(new Set());
  useEffect(() => { if (open) setItems(new Set()); }, [open]);
  const toggle = (value, checked) => setItems((current) => {
    const next = new Set(current);
    if (checked) next.add(value); else next.delete(value);
    return next;
  });
  return [items, toggle];
}

export function NewConversationDialog({open, onOpenChange, directory, names, meEmail, onCreated, embedded = false}) {
  const [tab, setTab] = useState("dm");
  const [groupName, setGroupName] = useState("");
  const [members, toggle] = useToggleSet(open);
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => directory.filter((person) => person.email !== meEmail), [directory, meEmail]);

  useEffect(() => {
    if (!open) return;
    setTab("dm");
    setGroupName("");
  }, [open]);

  const run = async (action) => {
    setBusy(true);
    try {
      const conversation = await action();
      if (!conversation?.id) throw new Error("Could not open conversation. Please try again.");
      if (conversation?.id) {
        onCreated(conversation);
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <>
        {embedded ? <p className="text-sm text-muted-foreground">Message one person directly, or start a group.</p> : (
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>Message one person directly, or start a group.</DialogDescription>
          </DialogHeader>
        )}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dm">Direct message</TabsTrigger>
            <TabsTrigger value="group">Group</TabsTrigger>
          </TabsList>
          <TabsContent value="dm" className="mt-4 space-y-2">
            <PeopleList people={people} names={names} single onPick={(email) => { if (!busy) run(() => chatApi.openDm(email)); }} />
            {busy && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Opening...</p>}
          </TabsContent>
          <TabsContent value="group" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" value={groupName} maxLength={80} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. West region coordinators" />
            </div>
            <PeopleList people={people} names={names} selected={members} onToggle={toggle} />
            <DialogFooter>
              <Button
                disabled={busy || !groupName.trim() || members.size === 0}
                onClick={() => run(() => chatApi.createGroup({name: groupName.trim(), members: [...members]}))}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Users className="mr-1 h-4 w-4" />}
                Create group ({members.size + 1} people)
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
    </>
  );
  if (embedded) return open ? <div className="space-y-4 p-3">{content}</div> : null;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg">{content}</DialogContent></Dialog>;
}

export function GroupSettingsDialog({open, onOpenChange, conversation, directory, names, onUpdated, onLeft}) {
  const [name, setName] = useState("");
  const [adding, toggle] = useToggleSet(open);
  const [busy, setBusy] = useState(false);
  const memberEmails = useMemo(() => new Set((conversation?.members || []).map((member) => member.email)), [conversation]);
  const candidates = useMemo(() => directory.filter((person) => !memberEmails.has(person.email)), [directory, memberEmails]);

  useEffect(() => {
    if (open) setName(conversation?.name || "");
  }, [open, conversation?.name]);

  const run = async (payload, done) => {
    setBusy(true);
    try {
      const updated = await chatApi.updateConversation({id: conversation.id, ...payload});
      done(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const payload = {};
    if (name.trim() && name.trim() !== conversation.name) payload.name = name.trim();
    if (adding.size) payload.addMembers = [...adding];
    if (!Object.keys(payload).length) {
      onOpenChange(false);
      return;
    }
    run(payload, (updated) => { onUpdated(updated); toast.success("Group updated"); });
  };

  if (!conversation) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
          <DialogDescription>{conversation.members?.length || 0} members</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-rename">Name</Label>
            <Input id="group-rename" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Members</Label>
            <div className="flex flex-wrap gap-1.5">
              {(conversation.members || []).map((member) => (
                <span key={member.email} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-1 pr-2.5 text-xs text-slate-700">
                  <UserAvatar email={member.email} name={displayName(member.email, names)} size={20} />
                  {displayName(member.email, names)}
                </span>
              ))}
            </div>
          </div>
          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><UserPlus className="h-4 w-4" /> Add people</Label>
              <PeopleList people={candidates} names={names} selected={adding} onToggle={toggle} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={busy}
            onClick={() => run({leave: true}, () => { onLeft(conversation.id); toast.success(`You left ${conversation.name}`); })}
          >
            <LogOut className="mr-1 h-4 w-4" /> Leave group
          </Button>
          <Button onClick={save} disabled={busy} className="bg-orange-600 hover:bg-orange-700">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
