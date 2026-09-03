# EnQuote Local Relay Services

Scripts that keep the Base44 &lt;-&gt; local-app sync relay (ngrok tunnel + `webhook-receiver.cjs`)
running reliably, without needing two terminal windows open all the time.

## Setup (run once)

```powershell
cd C:\EnQuoteBuild
powershell -ExecutionPolicy Bypass -File .\tools\services\install-services.ps1
powershell -ExecutionPolicy Bypass -File .\tools\services\install-watchdog.ps1
```

No admin rights required. This registers three Scheduled Tasks under a `\EnQuote\` folder,
all running as your own Windows user account:

| Task | What it does |
|---|---|
| `ngrok-tunnel` | Runs `ngrok http 3001` (the relay's public HTTPS endpoint). Starts at logon. |
| `webhook-receiver` | Runs `node webhook-receiver.cjs` (validates + imports Base44 snapshots). Starts at logon. |
| `sync-watchdog` | Runs every 3 minutes. Restarts either of the above if it isn't running, and alerts (Windows toast + log) if the last successful sync looks stale. **This is the real auto-restart mechanism** - see note below. |

The install script automatically stops any manually-started `ngrok.exe` / `node
webhook-receiver.cjs` processes first, so there's no port/tunnel conflict when switching
over.

## Why a separate watchdog task, instead of just "restart on failure"?

The `ngrok-tunnel` / `webhook-receiver` tasks are *also* configured with Task Scheduler's
built-in "restart on failure" setting, but testing showed this does **not** reliably fire
when a long-running foreground process is killed externally (verified directly: killing
the process did not trigger a restart within several minutes). The `sync-watchdog` task's
simple, recurring "is it alive? if not, start it" check was confirmed to work reliably, so
that's the mechanism actually relied on for crash recovery - the restart-on-failure setting
is left in place as a harmless secondary safety net, not the primary one.

## Why `run-hidden.vbs` instead of `-WindowStyle Hidden`?

All three tasks launch through `wscript.exe run-hidden.vbs "powershell.exe" ...` rather
than `powershell.exe -WindowStyle Hidden ...` directly. That flag is a well-documented,
long-standing unreliable mechanism when a process is started by Task Scheduler - in
practice it still let webhook-receiver.cjs's console window pop up and steal focus every
time it (re)started. `wscript.exe` has no console of its own, and its
`WScript.Shell.Run(cmd, 0, False)` call (window style `0` = hidden) suppresses the child
window at the Win32 level, which testing confirmed works reliably (verified with no
visible window appearing across multiple restarts and watchdog cycles). If you ever need
to watch the raw output live for debugging, temporarily run the relevant
`run-ngrok-tunnel.ps1` / `run-webhook-receiver.ps1` / `sync-watchdog.ps1` script directly
in a terminal instead of via the Scheduled Task.

## Checking status

```powershell
Get-ScheduledTask -TaskPath '\EnQuote\' | Select-Object TaskName, State
Get-Content C:\EnQuoteBuild\sync-watchdog.log -Tail 20
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://127.0.0.1:4040/api/tunnels
```

## Uninstalling

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\services\uninstall-services.ps1
```

Removes all three tasks and stops any processes they started, reverting to the manual
two-terminal workflow described in `QUICK_START.md`.

## Files

- `run-hidden.vbs` - generic hidden-launch helper (`wscript.exe run-hidden.vbs "<program>"
  "<arg1>" ...`) used by all three tasks so nothing ever flashes a console window.
- `run-ngrok-tunnel.ps1` / `run-webhook-receiver.ps1` - foreground wrapper scripts the
  `ngrok-tunnel` / `webhook-receiver` tasks execute. Must stay in the foreground (not
  detach) so Task Scheduler can tell when the underlying process exits.
- `sync-watchdog.ps1` - the health-check/auto-heal/alerting script the `sync-watchdog` task
  runs on its recurring schedule.
- `install-services.ps1` / `install-watchdog.ps1` - one-time setup, safe to re-run.
- `uninstall-services.ps1` - removes everything these scripts registered.

