import {useEffect, useState} from "react";

// Small, fixed-position notice for installer updates (electron-updater, relayed through
// main.cjs -> preload.cjs). Updates download quietly in the background; once one is ready this
// offers "Restart now" - or it installs on its own the next time EnQuote is closed. Renders
// nothing until there is something to say, and only exists inside the packaged desktop app
// (window.enquoteUpdater is undefined in dev/browser contexts, so this safely no-ops there).
export default function UpdateStatusBadge() {
  const [state, setState] = useState(null); // { status, version?, percent?, notes?, message? }
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = window.enquoteUpdater;
    if (!updater?.onUpdateStatus) return;
    // A "ready" event can fire before this window existed (or before a UI reload).
    updater.getState?.().then((existing) => { if (existing) setState(existing); }).catch(() => {});
    let hideTimer;
    const unsubscribe = updater.onUpdateStatus((data) => {
      clearTimeout(hideTimer);
      setState(data);
      if (data.status === "ready") setDismissed(false);
      // "up-to-date" is reassuring but not actionable - hide it after a few seconds.
      if (data.status === "up-to-date") hideTimer = setTimeout(() => setState(null), 4000);
    });
    return () => {
      clearTimeout(hideTimer);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  if (!state) return null;

  if (state.status === "ready") {
    if (dismissed) return null;
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg bg-emerald-600 p-3 text-white shadow-lg">
        <p className="text-sm font-semibold">EnQuote {state.version ? `v${state.version}` : "update"} is ready</p>
        {state.notes && <p className="mt-1 line-clamp-3 text-xs opacity-90">{state.notes}</p>}
        <p className="mt-1 text-xs opacity-90">It will also install automatically when you close EnQuote.</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            onClick={() => window.enquoteUpdater?.installNow?.()}
          >
            Restart now
          </button>
          <button
            type="button"
            className="rounded px-2.5 py-1 text-xs font-medium text-white/90 hover:bg-emerald-700"
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </div>
      </div>
    );
  }

  // Routine background checking is silent; only real activity or a problem is worth showing.
  if (state.status === "checking" || state.status === "up-to-date") return null;

  const styles = {
    available: "bg-blue-600 text-white",
    downloading: "bg-blue-600 text-white",
    error: "bg-rose-600 text-white"
  };

  const labels = {
    available: `Update v${state.version} available`,
    downloading: `Downloading update${state.version ? ` v${state.version}` : ""}... ${state.percent ?? 0}%`,
    error: "Update check failed - will retry shortly"
  };

  return (
    <div className={`fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ${styles[state.status] || styles.available}`}>
      {labels[state.status] || state.status}
    </div>
  );
}