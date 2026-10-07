import {useState} from "react";
import {useAuth} from "@/lib/AuthContext";
import {Button} from "@/components/ui/button";
import ViewingDebuggingConsole from "./ViewingDebuggingConsole";

export default function ViewingBanner() {
  const {viewingSession} = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!viewingSession) return null;
  async function run(action) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (actionError) {setError(actionError.message); setBusy(false);}
  }
  return (
    <header className="fixed inset-x-0 top-0 z-[100] flex h-24 items-center justify-between gap-4 border-b border-warning bg-background px-6 shadow-lg" aria-label="Read-only viewing mode">
      <div className="min-w-0">
        <p className="font-semibold">Viewing as {viewingSession.user.full_name || viewingSession.user.display_name || viewingSession.user.email} - read only</p>
        <p className="text-xs text-muted-foreground">Your authorization: {viewingSession.actor.email}. Messages, Tasks, private/local settings and all writes are blocked.</p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span>User</span>
        <select aria-label="Viewed user" disabled={busy} value={viewingSession.user.email} onChange={event => {
          const email = event.target.value;
          void run(() => window.enquotePreview.selectUser(email));
        }} className="max-w-64 rounded border border-border bg-background p-2">
          {viewingSession.users.map(user => <option key={user.email} value={user.email}>{user.name}</option>)}
        </select>
      </label>
      <ViewingDebuggingConsole />
      <Button disabled={busy} onClick={() => void run(() => window.enquotePreview.exit())}>Exit viewing mode</Button>
    </header>
  );
}
