import {useEffect, useState} from "react";
import {useAuth} from "@/lib/AuthContext";
import {rolesForUser} from "@/lib/rolePageAccess";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import * as adminApi from "./adminApi";
import {canPreviewUserAccess, userAccessPreview} from "./accessPreview";
import {useAccessPreview} from "./AccessPreviewContext";
import {getViewingAvailability} from "./viewingAvailability";

export default function UserAccessPreview({policyState, refreshKey = 0}) {
  const {user: actor} = useAuth();
  const {startPreview} = useAccessPreview();
  const authorized = canPreviewUserAccess(actor, policyState);
  const [snapshot, setSnapshot] = useState(null);
  const [email, setEmail] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [availability, setAvailability] = useState({ready: false, message: "Checking the running desktop viewing service..."});
  const canStart = availability.ready;

  useEffect(() => {
    let cancelled = false;
    setAvailability({ready: false, message: "Checking the running desktop viewing service..."});
    if (!authorized) return undefined;
    getViewingAvailability().then(result => {
      if (!cancelled) setAvailability(result);
    }).catch(checkError => {
      if (!cancelled) setAvailability({ready: false, message: `Could not verify viewing-mode availability: ${checkError.message}`});
    });
    return () => {cancelled = true;};
  }, [authorized, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    if (!authorized) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    adminApi.overview().then(result => {
      if (result?.ok !== true || result.offline || !Array.isArray(result.users)) {
        throw new Error("A live service account list could not be loaded.");
      }
      if (!cancelled) setSnapshot(result);
    }).catch(loadError => {
      if (!cancelled) setError(loadError.message || "Could not load access preview.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {cancelled = true;};
  }, [authorized, policyState.policy, refreshKey]);

  if (!authorized) return <p role="alert" className="text-sm text-destructive">Access preview requires a live Super Admin policy. Cached, missing, or failed policy checks cannot enable it.</p>;

  const users = (snapshot?.users || []).filter(user => user?.email);
  const target = users.find(user => user.email === email);
  const rows = target ? userAccessPreview(actor, policyState, target, snapshot.rolePages) : [];
  const visibleRows = rows.filter(row => `${row.page} ${row.reason}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <section className="space-y-4" aria-label="User access preview">
      <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
        <p className="font-semibold">Read-only access preview - you are still signed in as {actor.email}.</p>
        <p>Open the normal EnQuote pages in an isolated desktop window using this user&apos;s live permissions. No user session/token is assumed; private Tasks and Messages and all writes are blocked. Their Mac&apos;s local files and preferences are not reproduced.</p>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading current service accounts and page policy...</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && snapshot && (
        <>
          <div className="space-y-2">
            <Label htmlFor="access-preview-user">Preview user</Label>
            <Select value={target ? email : ""} onValueChange={setEmail}>
              <SelectTrigger id="access-preview-user"><SelectValue placeholder="Choose a user" /></SelectTrigger>
              <SelectContent>{users.map(user => (
                <SelectItem key={user.email} value={user.email}>{user.display_name || user.full_name || user.name || user.email} ({user.email})</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          {!users.length && <p className="text-sm text-muted-foreground">The service returned no accounts to preview.</p>}
          {target && (
            <>
              <Button disabled={!canStart || starting} onClick={async () => {
                setStarting(true);
                setError(null);
                try {await startPreview(snapshot, target.email);}
                catch (startError) {setError(startError.message);}
                finally {setStarting(false);}
              }}>{starting ? "Opening viewing mode..." : "Start read-only viewing mode"}</Button>
              {!canStart && <p role="status" className="text-sm text-warning">{availability.message}</p>}
              <p className="text-sm">Previewing {target.email}. Roles: {rolesForUser(target).join(", ") || "None"}. {rows.filter(row => row.allowed).length} of {rows.length} pages allowed.</p>
              <p className="text-xs text-muted-foreground">Source: current service account and {snapshot.rolePages ? "configured" : "default"} page policy. Per-page action authorization and the user&apos;s local cached role may differ.</p>
              <Input aria-label="Filter preview pages" placeholder="Filter pages or access reasons" value={filter} onChange={event => setFilter(event.target.value)} />
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted"><tr><th className="p-3 text-left">Page</th><th className="p-3 text-left">Access</th><th className="p-3 text-left">Reason</th></tr></thead>
                  <tbody>{visibleRows.map(row => (
                    <tr key={row.page} className="border-t border-border"><td className="p-3">{row.page.replace(/([a-z])([A-Z])/g, "$1 $2")}</td><td className="p-3">{row.allowed ? "Allowed" : "Denied"}</td><td className="p-3">{row.reason}</td></tr>
                  ))}</tbody>
                </table>
                {!visibleRows.length && <p className="p-3 text-sm text-muted-foreground">No pages match this filter.</p>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
