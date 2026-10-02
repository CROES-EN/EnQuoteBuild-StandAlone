import {useEffect, useState} from "react";

// Offers to reload into a UI update that was downloaded in the background (see
// electron/uiUpdate.cjs). These are small fixes that don't need a new installer or a restart.
// Nothing is applied until the person chooses to reload - or on the next launch - so no one
// loses what they're in the middle of. Renders nothing outside the packaged desktop app.
export default function UiUpdateBanner() {
  const [update, setUpdate] = useState(null); // { uiVersion, notes }
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const ui = window.enquoteLocal?.ui;
    if (!ui?.onUpdateReady) return undefined;
    return ui.onUpdateReady((data) => setUpdate(data));
  }, []);

  if (!update) return null;

  return (
    <div className="fixed bottom-28 right-4 z-50 w-80 rounded-lg bg-indigo-600 p-3 text-white shadow-lg">
      <p className="text-sm font-semibold">A quick update is ready</p>
      {update.notes && <p className="mt-1 line-clamp-3 text-xs opacity-90">{update.notes}</p>}
      <p className="mt-1 text-xs opacity-90">Reloading takes a second and keeps you signed in.</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={applying}
          className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
          onClick={() => { setApplying(true); window.enquoteLocal.ui.apply(); }}
        >
          {applying ? "Reloading..." : "Reload now"}
        </button>
        <button
          type="button"
          className="rounded px-2.5 py-1 text-xs font-medium text-white/90 hover:bg-indigo-700"
          onClick={() => setUpdate(null)}
        >
          Later
        </button>
      </div>
    </div>
  );
}
