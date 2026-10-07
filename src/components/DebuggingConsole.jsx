import {useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/lib/AuthContext";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {listErrors} from "@/features/developerConsole/errorLog";
import {availableDebugCommands, formatDebugResult, runDebugCommand} from "@/features/developerConsole/debugCommands";
import {toast} from "sonner";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";

export default function DebuggingConsole() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [command, setCommand] = useState("diagnose");
  const [entries, setEntries] = useState([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const sequence = useRef(0);
  const viewing = isReadonlyViewing();
  const commands = availableDebugCommands(globalThis.window?.enquoteLocal, globalThis.window?.enquoteUpdater, viewing);

  async function execute(input) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const result = await runDebugCommand(input, {
        bridge: globalThis.window?.enquoteLocal,
        updater: globalThis.window?.enquoteUpdater,
        user, queryClient, listErrors,
        viewing: viewing ? window.enquotePreview : null
      });
      setEntries(previous => [...previous.slice(-19), {
        id: ++sequence.current,
        at: new Date().toISOString(),
        output: formatDebugResult(result),
        ok: result.ok
      }]);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(entries.map(entry => `${entry.at}\n${entry.output}`).join("\n\n"));
      toast.success("Diagnostic transcript copied. Review before sharing.");
    } catch (error) {
      toast.error(`Could not copy diagnostics: ${error?.message || error}`);
    }
  }

  return (
    <section className="space-y-3" aria-label="Debugging Console">
      <h3 className="text-base font-semibold">Debugging Console</h3>
      <p className="text-xs text-muted-foreground">
        Safe, allowlisted commands only. No shell or JavaScript execution. Diagnostics do not change data.
        {viewing
          ? "Only this window's view refresh and live-permission recheck are allowed. Errors belong to this viewing session, not the selected user's computer."
          : "Refresh/update checks are labeled actions; an installer check can start a background download."}
        Output omits report rows and credentials and redacts common identifiers. Review before sharing.
      </p>
      <div className="flex flex-wrap gap-2">
        {commands.filter(item => !item.action).map(item => (
          <Button key={item.name} size="sm" variant="outline" title={item.unavailableReason || item.description} disabled={running || !item.available} onClick={() => {setCommand(item.name); void execute(item.name);}}>
            {item.name}
          </Button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={event => {event.preventDefault(); void execute(command);}}>
        <Input aria-label="Diagnostic command" value={command} disabled={running} onChange={event => setCommand(event.target.value)} placeholder="Type help or diagnose" autoComplete="off" spellCheck={false} />
        <Button type="submit" disabled={running || !command.trim()}>{running ? "Running..." : "Run"}</Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Actions available on this build: {commands.filter(item => item.action && item.available).map(item => item.name).join(", ")}.
        No automatic restart or UI reload. Missing native commands require a later desktop update.
      </p>
      {commands.some(item => !item.available) && (
        <p className="text-xs text-muted-foreground">
          Not available in this installed build: {commands.filter(item => !item.available).map(item => item.name).join(", ")}.
          {viewing ? "Downloads, shared-data reconciliation and private data remain blocked." : "The UI-only hotfix still supports permissions, local data, errors, UI checks and view refresh."}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!entries.length || running} onClick={copyTranscript}>Copy transcript</Button>
        <Button size="sm" variant="ghost" disabled={!entries.length || running} onClick={() => setEntries([])}>Clear output</Button>
      </div>
      <div aria-live="polite" aria-busy={running} className="space-y-2">
        {!entries.length && <p className="text-xs text-muted-foreground">{viewing ? "Run diagnose for this viewing session. Use the affected user's own app to inspect their Mac or installed code." : "Run diagnose on the affected Mac, or permissions and supervisor on Heather's machine."}</p>}
        {entries.map(entry => (
          <div key={entry.id} className={`rounded-lg border p-3 ${entry.ok ? "border-border" : "border-destructive/50"}`}>
            <p className="text-xs text-muted-foreground">{entry.at}</p>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono select-text">{entry.output}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
