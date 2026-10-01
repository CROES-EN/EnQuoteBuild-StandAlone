import {useEffect, useState} from "react";

// Small, fixed-position badge that surfaces electron-updater activity in the app itself.
// Listens to the "updater:status" events relayed from main.cjs -> preload.cjs (added via
// add-update-status-visibility-v2.ps1). Renders nothing until the first event arrives, and
// only exists at all inside the packaged desktop app (window.enquoteUpdater is undefined
// in dev/browser contexts, so this safely no-ops there).
export default function UpdateStatusBadge() {
  const [state, setState] = useState(null); // { status, version?, percent?, message? }

  useEffect(() => {
    if (!window.enquoteUpdater?.onUpdateStatus) return;
    window.enquoteUpdater.onUpdateStatus((data) => {
      setState(data);
      // "up-to-date" is reassuring but not actionable -- auto-hide it after a few seconds
      // so it doesn't linger as a permanent fixture on every launch.
      if (data.status === "up-to-date") {
        setTimeout(() => setState(null), 4000);
      }
    });
  }, []);

  if (!state) return null;

  const styles = {
    checking: "bg-secondary text-muted-foreground",
    available: "bg-blue-600 text-white",
    downloading: "bg-blue-600 text-white",
    ready: "bg-emerald-600 text-white",
    "up-to-date": "bg-emerald-600 text-white",
    error: "bg-rose-600 text-white"
  };

  const labels = {
    checking: "Checking for updates...",
    available: `Update v${state.version} available`,
    deferred: `Update v${state.version} postponed until next launch`,
    downloading: `Downloading update... ${state.percent ?? 0}%`,
    ready: `Update v${state.version} downloaded -- restarting EnQuote`,
    "up-to-date": "EnQuote is up to date",
    error: "Update check failed -- will retry next launch"
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ${styles[state.status] || styles.checking}`}
      title={state.status === "ready" ? "Fully quit and reopen EnQuote to apply this update." : undefined}
    >
      {labels[state.status] || state.status}
    </div>
  );
}
