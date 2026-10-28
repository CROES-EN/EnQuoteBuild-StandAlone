import { APP_PREFERENCES_CHANGED } from "./appPreferences.js";
import { getCurrentUserNamespace, notifyPreferencesSynced, onUserSessionChanged } from "./userScopedStorage.js";

/**
 * Keeps personal settings and customization identical between the desktop app and the browser.
 *
 * Every setting already lives in localStorage (mostly under `<key>::<email>`), so this observes
 * writes to an explicit allowlist of setting keys and syncs them to the signed-in user's private
 * preference list on the Worker. Only allowlisted keys are ever written from the server, so a
 * synced value can never replace session, sign-in or cached data.
 *
 * Conflicts resolve by the newest change. Values that existed before syncing started are
 * "seeded" with a fixed old stamp: the desktop seed outranks the browser seed so the first
 * sync carries existing desktop customization to the browser, and any real change made later
 * on either side wins over both.
 */

// Per-user keys stored as `<key>::<email>`.
const SCOPED_KEYS = new Set([
  "enquote_selected_theme_v1",
  "enquote_custom_theme_colors_v1",
  "enquote_custom_themes_v2",
  "enquote_follow_system_theme_v1",
  "enquote_app_preferences_v1",
  "enquote_sidebar_order_v2",
  "enquote_tasks_quote_attention_v1",
  "enquote_chat_appearance_v1",
  "enquote_case_work_team_v1",
  "enquote_workload_tiles_v1",
  "enquote_workload_column_order_v1",
  "enquote_workload_column_hidden_v1",
  "enquote_workload_default_sort_v1",
  "enquote_workload_density_v1",
  "enquote_workload_management_names_v1",
  "enquote_workload_my_name_v1",
  "enquote_workload_important_goal",
  "enquote_workload_salesforce_report_url",
  "enquote_autodrafter_salesforce_report_url",
  "enquote_supervisor_overview_period_v1",
  "enquote_supervisor_hourly_period_v1"
]);
const SCOPED_PREFIXES = [
  "enquote_report_table_hidden_columns_",
  "enquote_report_table_shown_columns_",
  "enquote_report_table_summary_fields_v1_",
  // Remembered page filters, sorting and tabs (usePageViewState).
  "enquote_view_v1:"
];
// Settings stored without a user suffix; synced as the signed-in user's value.
const UNSCOPED_KEYS = new Set([
  "enquote_sidebar_collapsed",
  "enquote:sop-library-nav-collapsed",
  "enquote_dismissed_announcement_id",
  "enquote_supervisor_import_column_prefs_v1",
  "enquote_executive_overview_tile_prefs_v1",
  "enquote_supervisor_report_inventory_checklist_v1"
]);

const META_KEY = "enquote_preference_sync_v1";
const BROWSER_SEED = "1970-01-01T00:00:00.001Z";
const DESKTOP_SEED = "1970-01-01T00:00:00.002Z";
const SEEDS = new Set([BROWSER_SEED, DESKTOP_SEED]);
const MAX_VALUE_LENGTH = 64 * 1024;
const BATCH_SIZE = 100;
const PUSH_DEBOUNCE_MS = 1000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;

export function isSyncedPreferenceKey(id) {
  if (typeof id !== "string" || !KEY_PATTERN.test(id)) return false;
  // Search boxes are transient per device; syncing every keystroke would churn the other client.
  if (id.startsWith("enquote_view_v1:") && id.endsWith(":search")) return false;
  return SCOPED_KEYS.has(id) || UNSCOPED_KEYS.has(id) || SCOPED_PREFIXES.some((prefix) => id.startsWith(prefix) && id.length > prefix.length);
}

/** Maps a localStorage key to its synced preference id for `email`, or null when not a setting. */
export function preferenceIdForStorageKey(storageKey, email) {
  if (typeof storageKey !== "string" || !email) return null;
  if (UNSCOPED_KEYS.has(storageKey)) return storageKey;
  const suffix = `::${email}`;
  if (!storageKey.endsWith(suffix)) return null;
  const id = storageKey.slice(0, -suffix.length);
  return isSyncedPreferenceKey(id) && !UNSCOPED_KEYS.has(id) ? id : null;
}

export function storageKeyForPreference(id, email) {
  return UNSCOPED_KEYS.has(id) ? id : `${id}::${email}`;
}

function nextStamp(previous, now) {
  const previousMs = Date.parse(previous || "") || 0;
  return new Date(Math.max(now(), previousMs + 1)).toISOString();
}

export function createPreferenceSync({
  storage,
  transport,
  getEmail = getCurrentUserNamespace,
  isDesktop = false,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onApplied = () => {},
  logger = console
}) {
  const originalGet = storage.getItem.bind(storage);
  let originalSet = storage.setItem;
  let originalRemove = storage.removeItem;
  let applyingRemote = false;
  let activeEmail = "";
  let meta = null;
  let running = Promise.resolve();
  let pushTimer = null;
  let pollTimer = null;
  let stopped = true;

  const signedInEmail = () => {
    const email = String(getEmail() || "").trim().toLowerCase();
    return email && email !== "__anonymous__" ? email : "";
  };
  const metaKey = (email) => `${META_KEY}::${email}`;

  function loadMeta(email) {
    if (meta && activeEmail === email) return meta;
    activeEmail = email;
    try {
      const parsed = JSON.parse(originalGet(metaKey(email)) || "null");
      meta = parsed && typeof parsed === "object"
        ? { cursor: String(parsed.cursor || ""), seeded: Boolean(parsed.seeded), stamps: parsed.stamps || {}, dirty: parsed.dirty || {} }
        : null;
    } catch {
      meta = null;
    }
    meta ||= { cursor: "", seeded: false, stamps: {}, dirty: {} };
    return meta;
  }

  function saveMeta() {
    if (!meta || !activeEmail) return;
    try {
      originalSet.call(storage, metaKey(activeEmail), JSON.stringify(meta));
    } catch (error) {
      logger.warn?.("[preference-sync] Could not save sync state:", error.message);
    }
  }

  function recordLocalChange(storageKey, before) {
    if (applyingRemote) return;
    const email = signedInEmail();
    const id = preferenceIdForStorageKey(storageKey, email);
    if (!id) return;
    const after = originalGet(storageKey);
    if (after === before) return;
    const state = loadMeta(email);
    state.stamps[id] = nextStamp(state.stamps[id], now);
    state.dirty[id] = true;
    saveMeta();
    schedulePush();
  }

  function instrument() {
    const target = typeof Storage !== "undefined" && storage instanceof Storage ? Storage.prototype : storage;
    originalSet = target.setItem;
    originalRemove = target.removeItem;
    target.setItem = function setItem(key, value) {
      if (this !== storage) return originalSet.call(this, key, value);
      const before = originalGet(key);
      originalSet.call(this, key, value);
      recordLocalChange(String(key), before);
      return undefined;
    };
    target.removeItem = function removeItem(key) {
      if (this !== storage) return originalRemove.call(this, key);
      const before = originalGet(key);
      originalRemove.call(this, key);
      recordLocalChange(String(key), before);
      return undefined;
    };
  }

  function seedExisting(email, state) {
    if (state.seeded) return;
    const seed = isDesktop ? DESKTOP_SEED : BROWSER_SEED;
    for (let index = 0; index < storage.length; index += 1) {
      const id = preferenceIdForStorageKey(storage.key(index), email);
      if (id && !state.stamps[id]) {
        state.stamps[id] = seed;
        state.dirty[id] = true;
      }
    }
    state.seeded = true;
    saveMeta();
  }

  async function pull(email, state) {
    const result = await transport.list(state.cursor);
    if (!result?.ok) throw new Error(result?.error || "Preferences could not be loaded.");
    const changed = [];
    applyingRemote = true;
    try {
      for (const entry of result.preferences || []) {
        if (!isSyncedPreferenceKey(entry?.key) || typeof entry.updatedAt !== "string") continue;
        const local = state.stamps[entry.key] || "";
        const sameSeed = SEEDS.has(local) && entry.updatedAt === local;
        if (!(entry.updatedAt > local || sameSeed)) continue;
        const storageKey = storageKeyForPreference(entry.key, email);
        const current = originalGet(storageKey);
        if (entry.deleted || entry.value == null) {
          if (current !== null) { originalRemove.call(storage, storageKey); changed.push(entry.key); }
        } else if (current !== entry.value) {
          originalSet.call(storage, storageKey, entry.value);
          changed.push(entry.key);
        }
        state.stamps[entry.key] = entry.updatedAt;
        delete state.dirty[entry.key];
      }
    } finally {
      applyingRemote = false;
    }
    if (typeof result.cursor === "string" && result.cursor) state.cursor = result.cursor;
    saveMeta();
    if (changed.length) onApplied(changed);
    return changed;
  }

  async function push(email, state) {
    const ids = Object.keys(state.dirty).filter(isSyncedPreferenceKey);
    for (const id of Object.keys(state.dirty)) if (!isSyncedPreferenceKey(id)) delete state.dirty[id];
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const entries = [];
      for (const id of ids.slice(start, start + BATCH_SIZE)) {
        const value = originalGet(storageKeyForPreference(id, email));
        if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
          logger.warn?.(`[preference-sync] "${id}" is too large to sync and stays on this device.`);
          delete state.dirty[id];
          continue;
        }
        entries.push({ key: id, updatedAt: state.stamps[id], value });
      }
      if (!entries.length) continue;
      const result = await transport.save(entries);
      if (!result?.ok) throw new Error(result?.error || "Preferences could not be saved.");
      for (const entry of entries) {
        if (state.stamps[entry.key] === entry.updatedAt) delete state.dirty[entry.key];
      }
      saveMeta();
    }
  }

  function schedulePoll(ms) {
    clearTimer(pollTimer);
    if (!stopped) pollTimer = setTimer(() => { void sync(); }, ms);
  }

  function schedulePush() {
    if (stopped) return;
    clearTimer(pushTimer);
    pushTimer = setTimer(() => { void sync(); }, PUSH_DEBOUNCE_MS);
  }

  function sync() {
    running = running.then(async () => {
      const email = signedInEmail();
      if (stopped || !email) return { ok: false, reason: "signed_out" };
      const state = loadMeta(email);
      try {
        seedExisting(email, state);
        const changed = await pull(email, state);
        await push(email, state);
        schedulePoll(POLL_INTERVAL_MS);
        return { ok: true, changed };
      } catch (error) {
        logger.warn?.("[preference-sync] Settings sync will retry:", error.message);
        schedulePoll(RETRY_MS);
        return { ok: false, error: error.message };
      }
    });
    return running;
  }

  instrument();
  return {
    start() { stopped = false; return sync(); },
    stop() { stopped = true; clearTimer(pushTimer); clearTimer(pollTimer); },
    sync,
    resetSession() { meta = null; activeEmail = ""; }
  };
}

let installed = null;

/** Installs settings sync for the running app (desktop or browser). Safe to call once. */
export function installPreferenceSync() {
  const win = globalThis.window;
  if (installed || !win?.localStorage) return installed;
  if (win.enquotePreview?.active) return null;
  const bridge = win.enquoteLocal?.preferences;
  if (!bridge?.list || !bridge?.save) return null;
  installed = createPreferenceSync({
    storage: win.localStorage,
    transport: bridge,
    isDesktop: !win.enquoteLocal.isBrowser,
    onApplied: (keys) => {
      win.dispatchEvent(new Event(APP_PREFERENCES_CHANGED));
      if (keys.includes("enquote_chat_appearance_v1")) {
        win.dispatchEvent(new CustomEvent("enquote_chat_appearance_changed"));
      }
      notifyPreferencesSynced(keys);
    }
  });
  bridge.onChanged?.(() => { void installed.sync(); });
  onUserSessionChanged(() => { installed.resetSession(); void installed.sync(); });
  win.addEventListener("focus", () => { void installed.sync(); });
  void installed.start();
  return installed;
}
