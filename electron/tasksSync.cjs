// Personal tasks/reminders: stored locally first (they work offline and survive restarts), then
// synced to the caller's private task list on the Worker so they follow the user between PCs.
// Conflicts resolve last-writer-wins on the record's updated_date.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_TICK_MS = 30 * 1000;
const PUSH_DEBOUNCE_MS = 1500;
// More reminders than this coming due at once (e.g. the PC was off all weekend) are
// summarised in one notification instead of a burst of pop-ups.
const MAX_INDIVIDUAL_ALERTS = 3;

function nextStamp(previous, now) {
  const prevMs = Date.parse(previous || "") || 0;
  return new Date(Math.max(now(), prevMs + 1)).toISOString();
}

// When a reminder should fire: a snooze replaces the original reminder time.
function reminderTime(task) {
  if (!task || task.status === "done") return null;
  const value = task.snoozed_until || task.remind_at;
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function isReminderDue(task, nowMs) {
  const at = reminderTime(task);
  if (at === null || at > nowMs) return false;
  const notified = Date.parse(task.notified_at || "");
  return !Number.isFinite(notified) || notified < at;
}

function emptyState(owner) {
  return { version: 1, owner, cursor: "", tasks: {}, dirty: {}, deletes: {} };
}

function createTasksSync({
  client,
  getEmail,
  storageDir,
  logger = console,
  now = () => Date.now(),
  onChanged = () => {},
  onDue = () => {}
}) {
  let state = null;
  let syncing = null;
  let resyncRequested = false;
  let pushTimer = null;
  let syncTimer = null;
  let reminderTimer = null;

  function fileFor(email) {
    const hash = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
    return path.join(storageDir, `enquote-tasks-${hash}.json`);
  }

  // Tasks are per person: the store is keyed by the signed-in email, so a shared PC never
  // shows one person's reminders to another.
  function load() {
    const email = String(getEmail() || "").toLowerCase();
    if (!email) return null;
    if (state?.owner === email) return state;
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(email), "utf8"));
      state = parsed?.owner === email ? { ...emptyState(email), ...parsed } : emptyState(email);
    } catch {
      state = emptyState(email);
    }
    return state;
  }

  function persist() {
    if (!state) return;
    const target = fileFor(state.owner);
    const temp = `${target}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(state), "utf8");
      fs.renameSync(temp, target);
    } catch (error) {
      logger.warn?.("[tasks] Could not save tasks:", error.message);
    }
  }

  function list() {
    const current = load();
    if (!current) return [];
    return Object.values(current.tasks).sort((a, b) => String(a.due_at || "").localeCompare(String(b.due_at || "")));
  }

  function changed() {
    try {
      onChanged(list());
    } catch (error) {
      logger.warn?.("[tasks] Change listener failed:", error.message);
    }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void sync();
    }, PUSH_DEBOUNCE_MS);
    pushTimer.unref?.();
  }

  function save(input) {
    const current = load();
    if (!current) throw new Error("Sign in to EnQuote before adding tasks.");
    if (!input || typeof input !== "object") throw new Error("Task details are missing.");
    const title = String(input.title || "").trim();
    if (!title) throw new Error("Give the task a title.");
    if (!Date.parse(input.due_at || "")) throw new Error("Pick a due date for the task.");

    const id = typeof input.id === "string" && input.id ? input.id : crypto.randomUUID();
    const existing = current.tasks[id];
    const stamp = nextStamp(existing?.updated_date, now);
    const record = {
      type: "other",
      notes: "",
      remind_at: null,
      status: "open",
      completed_at: null,
      snoozed_until: null,
      notified_at: null,
      quote_id: null,
      quote_label: null,
      contact_name: null,
      contact_phone: null,
      ...existing,
      ...input,
      id,
      title: title.slice(0, 200),
      created_date: existing?.created_date || input.created_date || stamp,
      updated_date: stamp
    };
    if (record.status === "done" && !record.completed_at) record.completed_at = stamp;
    if (record.status !== "done") record.completed_at = null;
    // Moving the reminder (or re-opening the task) re-arms it.
    if (existing && (existing.remind_at !== record.remind_at || existing.snoozed_until !== record.snoozed_until || (existing.status === "done" && record.status !== "done"))) {
      if (input.notified_at === undefined) record.notified_at = null;
    }

    current.tasks[id] = record;
    current.dirty[id] = true;
    delete current.deletes[id];
    persist();
    changed();
    schedulePush();
    return record;
  }

  function remove(id) {
    const current = load();
    if (!current || !current.tasks[id]) return false;
    const stamp = nextStamp(current.tasks[id].updated_date, now);
    delete current.tasks[id];
    delete current.dirty[id];
    current.deletes[id] = stamp;
    persist();
    changed();
    schedulePush();
    return true;
  }

  async function pushChanges(current) {
    for (const id of Object.keys(current.dirty)) {
      const record = current.tasks[id];
      if (!record) {
        delete current.dirty[id];
        continue;
      }
      await client.post("/api/tasks/upsert", { id, updatedAt: record.updated_date, record });
      // Only clear the flag if the task wasn't edited again while the request was in flight.
      if (current.tasks[id]?.updated_date === record.updated_date) delete current.dirty[id];
    }
    for (const [id, deletedAt] of Object.entries(current.deletes)) {
      await client.post("/api/tasks/delete", { id, deletedAt });
      if (current.deletes[id] === deletedAt) delete current.deletes[id];
    }
  }

  async function pullChanges(current) {
    let changedAny = false;
    // Pages until caught up (the Worker returns everything since the cursor).
    for (let page = 0; page < 20; page += 1) {
      const result = await client.get("/api/tasks", { since: current.cursor });
      const rows = Array.isArray(result.tasks) ? result.tasks : [];
      for (const row of rows) {
        if (!row?.id) continue;
        const local = current.tasks[row.id];
        const localStamp = local?.updated_date || current.deletes[row.id] || "";
        if (localStamp && localStamp >= row.updatedAt) continue;
        if (row.deleted) {
          if (local) {
            delete current.tasks[row.id];
            changedAny = true;
          }
          delete current.dirty[row.id];
          delete current.deletes[row.id];
        } else if (row.record && typeof row.record === "object") {
          current.tasks[row.id] = { ...row.record, id: row.id };
          delete current.dirty[row.id];
          delete current.deletes[row.id];
          changedAny = true;
        }
      }
      const advanced = result.cursor && result.cursor !== current.cursor;
      if (result.cursor) current.cursor = result.cursor;
      if (!rows.length || !advanced) break;
    }
    return changedAny;
  }

  async function runSync() {
    const current = load();
    if (!current || !client.isReady()) return { ok: false, reason: "not_connected" };
    try {
      await pushChanges(current);
      const changedAny = await pullChanges(current);
      persist();
      if (changedAny) changed();
      checkReminders();
      return { ok: true };
    } catch (error) {
      persist();
      if (!error.offline) logger.warn?.("[tasks] Sync failed:", error.message);
      return { ok: false, reason: error.code || "error", error: error.message };
    }
  }

  // Coalesces overlapping requests (timer + realtime nudge + local edit) into one run, plus
  // at most one follow-up so a change that arrives mid-sync is never missed.
  function sync() {
    if (syncing) {
      resyncRequested = true;
      return syncing;
    }
    syncing = (async () => {
      let result;
      do {
        resyncRequested = false;
        result = await runSync();
      } while (resyncRequested && result.ok);
      return result;
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  function checkReminders() {
    const current = load();
    if (!current) return;
    const nowMs = now();
    const due = Object.values(current.tasks).filter((task) => isReminderDue(task, nowMs));
    if (!due.length) return;
    due.sort((a, b) => reminderTime(a) - reminderTime(b));
    const stamp = new Date(nowMs).toISOString();
    for (const task of due) {
      // Recorded and synced so the same reminder doesn't fire again on the user's other PC.
      const updated = { ...task, notified_at: stamp, updated_date: nextStamp(task.updated_date, now) };
      current.tasks[task.id] = updated;
      current.dirty[task.id] = true;
    }
    persist();
    try {
      onDue(due.length > MAX_INDIVIDUAL_ALERTS ? { tasks: due, summary: true } : { tasks: due, summary: false });
    } catch (error) {
      logger.warn?.("[tasks] Reminder listener failed:", error.message);
    }
    changed();
    schedulePush();
  }

  function start() {
    stop();
    syncTimer = setInterval(() => { void sync(); }, SYNC_INTERVAL_MS);
    syncTimer.unref?.();
    reminderTimer = setInterval(checkReminders, REMINDER_TICK_MS);
    reminderTimer.unref?.();
    checkReminders();
    void sync();
  }

  function stop() {
    if (syncTimer) clearInterval(syncTimer);
    if (reminderTimer) clearInterval(reminderTimer);
    if (pushTimer) clearTimeout(pushTimer);
    syncTimer = null;
    reminderTimer = null;
    pushTimer = null;
  }

  return { list, save, remove, sync, start, stop, checkReminders };
}

module.exports = { createTasksSync, isReminderDue, reminderTime };
