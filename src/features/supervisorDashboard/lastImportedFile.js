/**
 * Remembers the most recently imported report file's name and on-disk path so the Supervisor
 * Dashboard can offer a quick "open it again" shortcut next to the Import Report button.
 *
 * The path is only ever available when running inside the Electron desktop app - browsers
 * never expose a local file's absolute path via `<input type="file">` for security reasons,
 * so outside Electron this module simply has nothing to remember and the shortcut stays
 * hidden ("assuming a spreadsheet exists"). This is a pure convenience pointer, stored
 * per-machine in localStorage - it never reads from or writes to the spreadsheet itself, it
 * only asks the OS to open it, exactly like double-clicking it in Explorer.
 */

const STORAGE_KEY = "enquote_supervisor_last_imported_file_v1";

export function getLastImportedFile() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ name: string, path: string|undefined, source: string }} info
 */
export function setLastImportedFile({ name, path, source }) {
  if (!path) return; // Nothing to remember outside Electron - no path was exposed.
  try {
    globalThis.window?.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      name,
      path,
      source,
      savedAt: new Date().toISOString()
    }));
  } catch {
    // Best-effort only - the shortcut just won't persist this time.
  }
}

export function canOpenLocalFiles() {
  return Boolean(globalThis.window?.enquoteLocal?.shell?.openPath);
}

/**
 * @returns {Promise<{ ok: boolean, error?: string, reason?: string }>}
 */
export async function openLastImportedFile() {
  const last = getLastImportedFile();
  if (!last?.path) return { ok: false, reason: "no-path" };

  const bridge = globalThis.window?.enquoteLocal?.shell;
  if (!bridge?.openPath) return { ok: false, reason: "unsupported" };

  return bridge.openPath(last.path);
}
