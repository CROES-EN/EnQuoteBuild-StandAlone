// Runs inside Electron with contextIsolation OFF so it can install a stand-in for the real
// preload bridge (window.enquoteLocal) directly in the page. Everything the app asks the main
// process for gets a harmless empty answer, with just enough real data (a signed-in admin) for
// the screens to render. Used only by scripts/smoke/main.cjs.
const IDENTITY = { email: "smoke.test@enphaseenergy.com" };
const USERS = [{ id: "smoke-user", email: IDENTITY.email, full_name: "Smoke Test", display_name: "Smoke Test", app_role: "admin", additional_roles: [] }];
if (process.argv.includes("--console-only")) USERS[0].app_role = "super_admin";
const SOPS = [
  {id: "smoke-section", kind: "section", title: "General", order: 0},
  {id: "workbook-legacy", kind: "workbook", title: "Legacy workbook", order: 1},
  {id: "smoke-legacy-section", kind: "section", title: "O&M Marketplace", workbook_id: "workbook-legacy", order: 0},
  {id: "smoke-page", title: "Stability SOP", section_id: "smoke-section", content_html: "<p>Cached SOP content.</p>", files: [], updated_date: "2026-10-05T00:00:00Z"}
];
const sopListeners = new Set();

function respond(path, args) {
  const key = path.join(".");
  window.__smokeCalls[key] = (window.__smokeCalls[key] || 0) + 1;
  const last = path[path.length - 1];
  if (process.argv.includes("--console-only")) {
    if (key === "admin.policy") return Promise.resolve({ok: true, me: USERS[0]});
    if (key === "admin.overview") return Promise.resolve({ok: true, users: USERS});
    if (key === "viewing.status") {
      if (window.__smokeViewingReady) return Promise.resolve({ok: true, supported: true, ready: true});
      return Promise.reject(new Error("No handler registered for 'viewing:status'"));
    }
  }
  if (key === "sops.onChanged") {
    sopListeners.add(args[0]);
    return () => sopListeners.delete(args[0]);
  }
  if (key === "sops.save") {
    if (window.__smokeSopSaveError) return Promise.resolve({ok: false, error: window.__smokeSopSaveError});
    const record = {...args[0], id: args[0].id || crypto.randomUUID(), deleted: false};
    const index = SOPS.findIndex((doc) => doc.id === record.id);
    if (index < 0) SOPS.push(record);
    else SOPS[index] = record;
    sopListeners.forEach((listener) => listener([...SOPS]));
    return Promise.resolve({ok: true, record});
  }
  if (key === "sops.delete") {
    const record = SOPS.find((doc) => doc.id === args[0]);
    if (!record) return Promise.resolve({ok: false, reason: "not_found"});
    record.deleted = true;
    sopListeners.forEach((listener) => listener([...SOPS]));
    return Promise.resolve({ok: true});
  }
  if (key === "sops.prepareOneNote") {
    const preview = (n, title) => ({
      ok: true, sessionId: `smoke-onenote-import${n}`, title, totalBytes: 1024,
      pages: [{id: `preview-page${n}`, title: "Imported parent", depth: 0, warnings: ["Images preserved in PDF."]}],
      warnings: ["Imported pages are shared.", "PDF snapshots preserve visual layout; embedded attachments are not extracted."]
    });
    return Promise.resolve({ok: true, previews: window.__smokeOneNoteMulti
      ? [preview("", "OneNote imported section"), preview("-2", "Second OneNote section")]
      : [preview("", "OneNote imported section")]});
  }
  if (key === "sops.cancelOneNote") return Promise.resolve({ok: true});
  if (key === "sops.importOneNote") {
    if (window.__smokeOneNoteError) return Promise.resolve({ok: false, error: "Imported 0 of 1 pages. Retry this preview."});
    const n = args[0].sessionId.replace("smoke-onenote-import", "");
    window.__smokeImportCalls = [...(window.__smokeImportCalls || []), args[0]];
    const title = n ? "Second OneNote section" : "OneNote imported section";
    const sectionId = args[0].sectionId || `smoke-imported-section${n}`;
    const parentPageId = args[0].sectionId ? `smoke-import-parent${n}` : null;
    if (!args[0].sectionId) SOPS.push({id: sectionId, kind: "section", title, workbook_id: "workbook-sop-library"});
    else SOPS.push({id: parentPageId, title, section_id: sectionId, parent_id: null, files: []});
    SOPS.push({id: `smoke-imported-page${n}`, title: n ? "Second imported page" : "Imported parent", section_id: sectionId, parent_id: parentPageId, files: [], content_html: "<p>Imported rich text</p>"});
    sopListeners.forEach((listener) => listener([...SOPS]));
    return Promise.resolve({ok: true, sectionId, parentPageId, imported: 1});
  }
  if (/^on[A-Z]/.test(last)) return () => {};
  if (key === "auth.getVerifiedIdentity") return Promise.resolve(IDENTITY);
  if (key === "auth.hasAccount") return Promise.resolve(true);
  if (key === "collections.list") return Promise.resolve(args[0] === "users" ? USERS : []);
  if (key === "largeTables.get" || key === "updater.getState") return Promise.resolve(null);
  if (key === "ui.getInfo") return Promise.resolve({ appVersion: "smoke", uiVersion: null });
  if (key === "remoteSync.checkStatus") return Promise.resolve({ ok: true });
  const teammateProfile = {email: "teammate@example.invalid", name: "Retro Teammate", mood: "Testing", html: "<h1>Teammate profile</h1>", css: ""};
  if (key === "Base44_DTO.list") return Promise.resolve({ok: true, profiles: [...(window.__smokeRetroProfile ? [window.__smokeRetroProfile] : []), teammateProfile], cursor: null});
  if (key === "Base44_DTO.save") {
    window.__smokeRetroProfile = {...args[0], email: IDENTITY.email};
    return Promise.resolve({ok: true, profile: window.__smokeRetroProfile});
  }
  if (key === "Base44_DTO.get") return Promise.resolve({ok: true, profile: args[0] === teammateProfile.email ? teammateProfile : window.__smokeRetroProfile});
  if (key === "chat.openDm") {
    window.__smokeDmEmail = args[0];
    return Promise.resolve({ok: true, conversation: {id: "smoke-chat"}});
  }
  if (key === "chat.me") return Promise.resolve({email: IDENTITY.email, unreadTotal: 0});
  if (key === "chat.directory") return Promise.resolve([...USERS.map((user) => ({email: user.email, name: user.full_name})),
    {email: "teammate@example.invalid", name: "Retro Teammate"}]);
  if (key === "chat.send") {
    window.__smokeTaskRequests = [...(window.__smokeTaskRequests || []), args[0]];
    if (window.__smokeTaskSendFail) return Promise.resolve({ok: false, error: "unreachable"});
    return Promise.resolve({ok: true, message: {id: args[0].clientId, conversationId: args[0].conversationId,
      assignedTaskId: `chat-task:${args[0].clientId}`, sender: IDENTITY.email,
      body: args[0].body, attachments: [], createdAt: new Date().toISOString()}});
  }
  if (key === "chat.conversations") return Promise.resolve([
    {id: "smoke-chat", kind: "dm", members: [{email: IDENTITY.email}, {email: "teammate@example.invalid"}], unread: 0}
  ]);
  if (key === "chat.messages") return Promise.resolve([
    {id: "smoke-message-mine", sender: IDENTITY.email, body: "Theme-aware message", createdAt: "2026-10-05T00:00:00Z", attachments: []},
    {id: "smoke-message-theirs", sender: "teammate@example.invalid", body: "Reply", createdAt: "2026-10-05T00:01:00Z", attachments: []}
  ]);
  if (key === "profiles.list") return Promise.resolve({ok: true, profiles: [{email: IDENTITY.email, avatarId: "b".repeat(64)}]});
  if (key === "profiles.getAvatar") return Promise.resolve({ok: true, type: "image/gif", bytes: new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"))});
  if (key === "profiles.setAvatar") {
    window.__smokeUploadedAvatar = {type: args[0].type, bytes: Array.from(args[0].bytes)};
    return Promise.resolve({ok: true, avatarId: "a".repeat(64)});
  }
  if (key === "sops.list") return Promise.resolve([...SOPS]);
  if (/^(list|filter|getAll|getUsers)/.test(last) || key.endsWith(".list")) return Promise.resolve([]);
  if (/^get/.test(last)) return Promise.resolve(null);
  return Promise.resolve({ ok: true });
}

window.__smokeCalls = {};
window.enquoteLocal = new Proxy({}, { get: (_t, prop) => (typeof prop === "symbol" || prop === "then" ? undefined : makeNodeFrom([prop])) });
function makeNodeFrom(path) {
  return new Proxy(function () {}, {
    get: (target, prop) => {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      if (prop === "call" || prop === "apply" || prop === "bind") return Reflect.get(target, prop);
      return makeNodeFrom([...path, prop]);
    },
    apply: (_target, _this, args) => respond(path, args)
  });
}
window.enquoteUpdater = makeNodeFrom(["updater"]);

// Collect anything that would show as an error to a user.
window.__smokeErrors = [];
window.addEventListener("error", (event) => window.__smokeErrors.push(`window.onerror: ${event.message}`));
window.addEventListener("unhandledrejection", (event) => window.__smokeErrors.push(`unhandledrejection: ${event.reason?.message || event.reason}`));
