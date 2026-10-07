import {useEffect, useMemo, useState} from "react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Checkbox} from "@/components/ui/checkbox";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Textarea} from "@/components/ui/textarea";
import {ALL_PAGES, DEFAULT_ROLE_PAGES, rolesForUser} from "@/lib/rolePageAccess";
import * as adminApi from "./adminApi";
import {toast} from "sonner";
import {ChevronDown, Shield} from "lucide-react";
import {sessionTelemetry} from "./sessionTelemetry";

const PAGE_LABELS = Object.freeze(Object.fromEntries(ALL_PAGES.map((page) => [page, page.replace(/([a-z])([A-Z])/g, "$1 $2")])));

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function pageLabel(page) {
  return PAGE_LABELS[page] || page;
}

function roleLabel(role) {
  return String(role || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function userName(user) {
  return user?.display_name || user?.full_name || user?.name || user?.email || "Unknown user";
}

function TogglePageList({selected, onChange, compact = false}) {
  const selectedSet = new Set(selected || []);
  return (
    <div className={compact ? "grid grid-cols-1 sm:grid-cols-2 gap-2" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"}>
      {ALL_PAGES.map((page) => (
        <label key={page} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <Checkbox
            checked={selectedSet.has(page)}
            onCheckedChange={(checked) => {
              const next = new Set(selectedSet);
              if (checked) next.add(page); else next.delete(page);
              onChange([...next].sort());
            }}
          />
          <span>{pageLabel(page)}</span>
        </label>
      ))}
    </div>
  );
}

function UserOverridePanel({users, roles, onRefresh}) {
  const [email, setEmail] = useState(users[0]?.email || "");
  const selected = users.find((user) => user.email === email) || null;
  const [form, setForm] = useState({app_role: "", additional_roles: [], allow_pages: [], deny_pages: []});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!email && users[0]?.email) setEmail(users[0].email);
  }, [email, users]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      app_role: selected.app_role || "",
      additional_roles: asList(selected.additional_roles),
      allow_pages: asList(selected.allow_pages),
      deny_pages: asList(selected.deny_pages)
    });
  }, [selected]);

  if (!selected) return <p className="text-sm text-muted-foreground">No users are available yet.</p>;
  const effectiveRoles = rolesForUser(selected);

  async function saveOverride() {
    setSaving(true);
    try {
      await adminApi.setUserOverride({email, ...form});
      toast.success("User override saved.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not save user override.");
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    setSaving(true);
    try {
      await adminApi.setUserOverride({email, clear: true});
      toast.success("User override cleared.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not clear override.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div>
          <Label>User</Label>
          <Select value={email} onValueChange={setEmail}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {users.map((user) => <SelectItem key={user.email} value={user.email}>{userName(user)} — {user.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p><span className="text-muted-foreground">Source:</span> {selected.role_source || "base44"}</p>
          <p><span className="text-muted-foreground">Effective:</span> {effectiveRoles.map(roleLabel).join(", ") || "none"}</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Primary role override</Label>
          <Select value={form.app_role || "__none"} onValueChange={(value) => setForm((prev) => ({...prev, app_role: value === "__none" ? "" : value, additional_roles: prev.additional_roles.filter((role) => role !== value)}))}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Use Base44 role</SelectItem>
              {roles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Additional role overrides</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {roles.filter((role) => role !== form.app_role).map((role) => (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={form.additional_roles.includes(role) ? "default" : "outline"}
                onClick={() => setForm((prev) => ({...prev, additional_roles: prev.additional_roles.includes(role) ? prev.additional_roles.filter((item) => item !== role) : [...prev.additional_roles, role].sort()}))}
              >
                {roleLabel(role)}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3 border-emerald-200">
          <div><h3 className="font-semibold text-foreground">Always allow pages</h3><p className="text-xs text-muted-foreground">These win after hidden pages.</p></div>
          <TogglePageList compact selected={form.allow_pages} onChange={(allow_pages) => setForm((prev) => ({...prev, allow_pages, deny_pages: prev.deny_pages.filter((page) => !allow_pages.includes(page))}))} />
        </Card>
        <Card className="p-4 space-y-3 border-rose-200">
          <div><h3 className="font-semibold text-foreground">Hide pages</h3><p className="text-xs text-muted-foreground">Hidden pages win over every role and allow list.</p></div>
          <TogglePageList compact selected={form.deny_pages} onChange={(deny_pages) => setForm((prev) => ({...prev, deny_pages, allow_pages: prev.allow_pages.filter((page) => !deny_pages.includes(page))}))} />
        </Card>
      </div>
      <div className="flex gap-2">
        <Button onClick={saveOverride} disabled={saving}>{saving ? "Saving..." : "Save override"}</Button>
        <Button variant="outline" onClick={clearOverride} disabled={saving}>Clear override</Button>
      </div>
    </div>
  );
}

function RolePagesPanel({roles, rolePages, onRefresh}) {
  const [matrix, setMatrix] = useState(rolePages || DEFAULT_ROLE_PAGES);
  const [saving, setSaving] = useState(false);
  useEffect(() => setMatrix(rolePages || DEFAULT_ROLE_PAGES), [rolePages]);

  async function save() {
    setSaving(true);
    try {
      await adminApi.setRolePages({rolePages: matrix});
      toast.success("Role page matrix saved.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not save role pages.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await adminApi.setRolePages({reset: true});
      toast.success("Role page matrix reset to defaults.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not reset role pages.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Admin and Super Admin always keep every page. Other roles use this matrix unless a user override says otherwise.</p>
      {roles.map((role) => (
        <Card key={role} className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-foreground">{roleLabel(role)}</h3>
            <Badge variant="outline">{asList(matrix?.[role]).length} pages</Badge>
          </div>
          <TogglePageList selected={asList(matrix?.[role])} onChange={(pages) => setMatrix((prev) => ({...prev, [role]: pages}))} />
        </Card>
      ))}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save matrix"}</Button>
        <Button variant="outline" onClick={reset} disabled={saving}>Reset to defaults</Button>
      </div>
    </div>
  );
}

function AnnouncementPanel({announcement, onRefresh}) {
  const [level, setLevel] = useState(announcement?.level || "info");
  const [text, setText] = useState(announcement?.text || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLevel(announcement?.level || "info"); setText(announcement?.text || ""); }, [announcement]);

  async function save() {
    setSaving(true);
    try {
      await adminApi.setAnnouncement({level, text});
      toast.success("Announcement saved.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not save announcement.");
    } finally { setSaving(false); }
  }

  async function clear() {
    setSaving(true);
    try {
      await adminApi.setAnnouncement({clear: true});
      toast.success("Announcement cleared.");
      await onRefresh?.();
    } catch (error) {
      toast.error(error.message || "Could not clear announcement.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <div>
          <Label>Level</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Banner text</Label>
          <Textarea className="mt-1.5" value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder="Tell everyone what they need to know..." />
        </div>
      </div>
      {announcement && <p className="text-xs text-muted-foreground">Current id {announcement.id}; last updated by {announcement.updatedBy || "unknown"}.</p>}
      <div className="flex gap-2"><Button onClick={save} disabled={saving || !text.trim()}>Save banner</Button><Button variant="outline" onClick={clear} disabled={saving}>Clear banner</Button></div>
    </div>
  );
}

function SessionsPanel({sessions, onRefresh}) {
  const [busy, setBusy] = useState(false);
  async function run(action) {
    setBusy(true);
    try { await action(); await onRefresh?.(); } catch (error) { toast.error(error.message || "Session action failed."); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => run(() => adminApi.clearSessions({}))}>Clear stale ghosts</Button><Button variant="outline" disabled={busy} onClick={onRefresh}>Refresh</Button></div>
      <p className="text-xs text-muted-foreground">
        Versions and Resolved role come from the app&apos;s heartbeat; Effective role comes from the server.
        Not reported means missing telemetry, not proof of an old version. A blank UI version can also mean the bundled UI.
        On the affected device, run runtime and permissions in Developer Console &gt; Debugging Console.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm"><thead className="bg-muted text-muted-foreground"><tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Versions</th><th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Last seen</th><th className="px-3 py-2 text-left">Actions</th></tr></thead>
          <tbody>{sessions.map((session) => {
            const telemetry = sessionTelemetry(session);
            return <tr key={session.sessionId} className="border-t border-border"><td className="px-3 py-2"><div className="font-medium">{session.name || session.email}</div><div className="text-xs text-muted-foreground">{session.email}</div></td><td className="px-3 py-2">App {telemetry.app}<br />UI {telemetry.ui}{telemetry.missing && <p className="text-xs text-muted-foreground">Incomplete app telemetry</p>}</td><td className={telemetry.mismatch ? "px-3 py-2 text-amber-700 font-medium" : "px-3 py-2"}>Resolved {telemetry.resolvedRole}<br />Effective {telemetry.effectiveRole}</td><td className="px-3 py-2">{session.lastSeen || "?"}{session.stale ? <Badge className="ml-2" variant="secondary">stale</Badge> : null}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => run(() => adminApi.command({email: session.email, command: "reload"}))}>Reload</Button><Button size="sm" variant="outline" onClick={() => run(() => adminApi.command({email: session.email, command: "sign_out"}))}>Sign out</Button><Button size="sm" variant="ghost" onClick={() => run(() => adminApi.clearSessions({sessionId: session.sessionId}))}>Clear</Button></div></td></tr>;
          })}</tbody></table>
      </div>
    </div>
  );
}

function ModerationPanel({users}) {
  const [sopId, setSopId] = useState("");
  const [email, setEmail] = useState(users[0]?.email || "");
  async function purgeSop() {
    try { await adminApi.purgeSop(sopId.trim()); setSopId(""); toast.success("SOP page purged."); } catch (error) { toast.error(error.message || "Could not purge SOP."); }
  }
  async function resetAvatar() {
    try { await adminApi.resetAvatar(email); toast.success("Profile picture reset."); } catch (error) { toast.error(error.message || "Could not reset avatar."); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 space-y-3"><h3 className="font-semibold">Purge SOP page</h3><p className="text-sm text-muted-foreground">Permanently hides a deleted SOP and removes its versions.</p><Input value={sopId} onChange={(event) => setSopId(event.target.value)} placeholder="SOP id" /><Button variant="destructive" onClick={purgeSop} disabled={!sopId.trim()}>Purge SOP</Button></Card>
      <Card className="p-4 space-y-3"><h3 className="font-semibold">Reset profile picture</h3><Select value={email} onValueChange={setEmail}><SelectTrigger><SelectValue placeholder="Choose user" /></SelectTrigger><SelectContent>{users.map((user) => <SelectItem key={user.email} value={user.email}>{userName(user)} — {user.email}</SelectItem>)}</SelectContent></Select><Button onClick={resetAvatar} disabled={!email}>Reset avatar</Button></Card>
    </div>
  );
}

function AuditPanel({entries, onRefresh}) {
  return <div className="space-y-3"><Button variant="outline" onClick={onRefresh}>Refresh audit log</Button><div className="rounded-lg border border-border divide-y divide-border">{entries.length ? entries.map((entry) => <div key={entry.id} className="p-3 text-sm"><div className="flex flex-wrap gap-2 items-center"><Badge variant="outline">#{entry.id}</Badge><span className="font-medium">{entry.action}</span><span className="text-muted-foreground">{entry.actor}</span><span className="text-muted-foreground">{entry.at}</span></div><div className="text-muted-foreground mt-1">Target: {entry.target || "—"}</div>{entry.details ? <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(entry.details, null, 2)}</pre> : null}</div>) : <p className="p-4 text-sm text-muted-foreground">No audit entries yet.</p>}</div></div>;
}

function AdminMenuContent({users: fallbackUsers = []}) {
  const [overview, setOverview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const users = useMemo(() => (overview?.users?.length ? overview.users : fallbackUsers).filter((user) => user?.email), [overview, fallbackUsers]);
  const roles = overview?.roles || Object.keys(DEFAULT_ROLE_PAGES);

  async function refresh() {
    setLoading(true);
    try {
      const [overviewResult, sessionsResult, auditResult] = await Promise.all([
        adminApi.overview(),
        adminApi.sessions(),
        adminApi.audit({limit: 50})
      ]);
      setOverview(overviewResult);
      setSessions(sessionsResult.sessions || []);
      setAuditEntries(auditResult.entries || []);
    } catch (error) {
      toast.error(error.message || "Could not load Admin Menu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <div className="border-t border-border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div><h2 className="text-xl font-semibold text-foreground">Admin Menu</h2><p className="text-sm text-muted-foreground">Override access, publish announcements, manage live sessions, moderate content, and review audit history.</p></div>
        <Button variant="outline" onClick={refresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</Button>
      </div>
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="users">User overrides</TabsTrigger><TabsTrigger value="pages">Role pages</TabsTrigger><TabsTrigger value="announcement">Announcement</TabsTrigger><TabsTrigger value="sessions">Live sessions</TabsTrigger><TabsTrigger value="moderation">Moderation</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>
        <TabsContent value="users"><UserOverridePanel users={users} roles={roles} onRefresh={refresh} /></TabsContent>
        <TabsContent value="pages"><RolePagesPanel roles={roles} rolePages={overview?.rolePages} onRefresh={refresh} /></TabsContent>
        <TabsContent value="announcement"><AnnouncementPanel announcement={overview?.announcement} onRefresh={refresh} /></TabsContent>
        <TabsContent value="sessions"><SessionsPanel sessions={sessions} onRefresh={refresh} /></TabsContent>
        <TabsContent value="moderation"><ModerationPanel users={users} /></TabsContent>
        <TabsContent value="audit"><AuditPanel entries={auditEntries} onRefresh={refresh} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function AdminMenu({users}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-6 overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls="admin-menu-content"
        onClick={() => setOpen((value) => !value)}
      >
        <Shield className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1">Admin Menu</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id="admin-menu-content"><AdminMenuContent users={users} /></div>}
    </Card>
  );
}
