import {lazy} from "react";

const RELOAD_KEY = "enquote:chunk-reload";

// Loads a page chunk on demand. If a chunk is missing (for example after a UI
// update swapped the bundle), reload once so the new index.html is used.
export function lazyPage(loader, exportName = "default") {
  return lazy(() =>
    loader()
      .then((mod) => {
        try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ }
        return {default: mod[exportName]};
      })
      .catch((error) => {
        let alreadyReloaded = false;
        try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1"; } catch { /* ignore */ }
        if (!alreadyReloaded) {
          try { sessionStorage.setItem(RELOAD_KEY, "1"); } catch { /* ignore */ }
          window.location.reload();
          return new Promise(() => {});
        }
        throw error;
      }),
  );
}
