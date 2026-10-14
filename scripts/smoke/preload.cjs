// Runs inside Electron with contextIsolation OFF so it can install a stand-in for the real
// preload bridge (window.enquoteLocal) directly in the page. Everything the app asks the main
// process for gets a harmless empty answer, with just enough real data (a signed-in admin) for
// the screens to render. Used only by scripts/smoke/main.cjs.
const IDENTITY = { email: "smoke.test@enphaseenergy.com" };
const USERS = [{ id: "smoke-user", email: IDENTITY.email, full_name: "Smoke Test", display_name: "Smoke Test", app_role: "admin", additional_roles: [] }];
if (process.argv.includes("--console-only")) USERS[0].app_role = "super_admin";
// Suites may replace the SOP fixture with window.__smokeSopDocs; every SOP mock reads and writes the same list.
const sopDocs = () => window.__smokeSopDocs || SOPS;
const SOPS = [
  {id:"panel-forms-smoke", title:"Smoke Panels RMA", category:"Panel-Module RMA",
    content_html:'<p><a href="https://manufacturer.example/claim">Claim form</a></p>', files:[], updated_date:"2026-10-13T00:00:00Z"},
  {id:"panel-rma-smoke", title:"Standard RMA Submission Steps", category:"Panel-Module RMA",
    content_html:"<ol><li>Gather panel model and serial numbers.</li><li>Attach clear photos in JPG or PNG.</li><li>Proof of purchase (if required).</li></ol>",
    files:[], updated_date:"2026-10-13T00:00:00Z"},
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
  if (key === "panelRmaForms.open") {
    if (window.__smokeMissingPanelFormHandler) return Promise.reject(new Error("No handler registered for 'panelRmaForms:open'"));
    return Promise.resolve({ok:true});
  }
  if (key.startsWith("retroGames.")) {
    const games = window.__smokeGames ||= [];
    const scores = window.__smokeArcadeScores ||= {};
    if (key === "retroGames.scores") return Promise.resolve({ok: true, personal: {...scores},
      boards: Object.fromEntries(["snake", "memory", "solitaire"].map(kind => [kind,
        scores[kind] === undefined ? [] : [{email: IDENTITY.email, value: scores[kind]}]]))});
    if (key === "retroGames.score") {
      const {kind, value} = args[0];
      scores[kind] = scores[kind] === undefined ? value : kind === "snake" ? Math.max(scores[kind], value) : Math.min(scores[kind], value);
      return Promise.resolve({ok: true, kind, best: scores[kind]});
    }
    if (key === "retroGames.list") {
      if (window.__smokeGamesUnavailable) return Promise.resolve({ok:false,error:"http_404"});
      return Promise.resolve({ok: true, me: IDENTITY.email, players: ["teammate@example.invalid", "unpublished@example.invalid"], games: structuredClone(games)});
    }
    if (key === "retroGames.get") return Promise.resolve({ok: true, game: structuredClone(games.find(game => game.id === args[0])), serverNow: Date.now()});
    const payload = args[0];
    if (payload.action === "challenge") {
      const game = {id: payload.id, kind: payload.kind, challenger: IDENTITY.email, opponent: payload.to,
        status: "pending", turn: IDENTITY.email, version: 1, board: Array(9).fill(null)};
      if (payload.kind === "connect") game.board = Array(42).fill(null);
      if (payload.kind === "checkers") {
        game.forced = null;
        game.board = Array.from({length:64}, (_, i) => {
          const row = Math.floor(i / 8);
          return (row + i % 8) % 2 && (row < 3 || row > 4)
            ? {side: row < 3 ? payload.to : IDENTITY.email, king:false, forward: row < 3 ? 1 : -1} : null;
        });
      }
      if (payload.kind === "battleship") Object.assign(game, {phase:"setup",turn:null,fleet:[],incoming:[],shots:[],sunk:[],
        ready:{[IDENTITY.email]:false,[payload.to]:false}});
      games.push(game);
      return Promise.resolve({ok: true, game: structuredClone(game), serverNow: Date.now()});
    }
    const game = games.find(game => game.id === payload.id);
    if (payload.action === "cancel") {game.status = "cancelled"; game.version++;}
    if (payload.action === "accept") {game.status = "active"; game.version++;}
    if (payload.action === "decline") {game.status = "declined"; game.version++;}
    if (payload.action === "place") {
      game.fleet[payload.ship] = Array.from({length:[5,4,3,3,2][payload.ship]}, (_, i) => payload.index + i * (payload.vertical ? 10 : 1));
      game.version++;
    }
    if (payload.action === "randomize") {game.fleet = [[0,1,2,3,4],[10,11,12,13],[20,21,22],[30,31,32],[40,41]]; game.version++;}
    if (payload.action === "ready") {game.ready[IDENTITY.email] = true; game.version++;}
    if (payload.action === "move") {
      if (game.kind === "tic") {game.board[payload.index] = game.challenger === IDENTITY.email ? "X" : "O"; game.turn = game.challenger;}
      else if (game.kind === "connect") {
        let row = 5; while (game.board[row * 7 + payload.index]) row--;
        game.board[row * 7 + payload.index] = IDENTITY.email; game.turn = game.opponent;
      }
      else if (game.kind === "checkers") {
        game.board[payload.index] = game.board[payload.from]; game.board[payload.from] = null; game.turn = game.opponent;
      }
      else if (game.kind === "battleship") {game.shots.push({index:payload.index,hit:true}); game.turn = game.opponent;}
      else {
        game.cards[payload.index] = "SUN";
        game.open.push(payload.index);
        if (game.open.length === 2) {game.matched.push(...game.open); game.open = []; game.scores[IDENTITY.email]++;}
      }
      game.version++;
    }
    return Promise.resolve({ok: true, game: structuredClone(game), serverNow: Date.now()});
  }
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
    const docs = window.__smokeSopDocs || SOPS;
    const index = docs.findIndex((doc) => doc.id === record.id);
    if (index < 0) docs.push(record);
    else docs[index] = record;
    sopListeners.forEach((listener) => listener([...docs]));
    return Promise.resolve({ok: true, record});
  }
  if (key === "sops.uploadFile") return Promise.resolve({ok:true,file:{fileId:"uploaded-blank-form",name:args[0].name,type:args[0].type,size:args[0].bytes.length}});
  if (key === "sops.delete") {
    const record = sopDocs().find((doc) => doc.id === args[0]);
    if (!record) return Promise.resolve({ok: false, reason: "not_found"});
    record.deleted = true;
    sopListeners.forEach((listener) => listener([...sopDocs()]));
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
    if (!args[0].sectionId) sopDocs().push({id: sectionId, kind: "section", title, workbook_id: "workbook-sop-library"});
    else sopDocs().push({id: parentPageId, title, section_id: sectionId, parent_id: null, files: []});
    sopDocs().push({id: `smoke-imported-page${n}`, title: n ? "Second imported page" : "Imported parent", section_id: sectionId, parent_id: parentPageId, files: [], content_html: "<p>Imported rich text</p>"});
    sopListeners.forEach((listener) => listener([...sopDocs()]));
    return Promise.resolve({ok: true, sectionId, parentPageId, imported: 1});
  }
  if (/^on[A-Z]/.test(last)) return () => {};
  if (key === "auth.getVerifiedIdentity") return Promise.resolve(IDENTITY);
  if (key === "auth.hasAccount") return Promise.resolve(true);
  if (key === "quoteBacklog.get") return Promise.resolve(window.__smokeBacklog?.[args[0]] || {ok: true, live: false, snapshot: null});
  if (key === "collections.create" && args[0] === "autoDrafterGeneratedDrafts") {
    const records = (window.__smokeCollections ||= {}).autoDrafterGeneratedDrafts ||= [];
    if (records.some(record => record.caseNumber === args[1].caseNumber)) return Promise.reject(new Error("This case already has a saved Auto-Drafter quote."));
    records.push(structuredClone(args[1]));
    return Promise.resolve(structuredClone(args[1]));
  }
  if (key === "collections.update" && args[0] === "autoDrafterGeneratedDrafts") {
    const records = window.__smokeCollections?.autoDrafterGeneratedDrafts || [];
    const index = records.findIndex(record => record.id === args[1]);
    if (index < 0) return Promise.reject(new Error("Record not found"));
    records[index] = structuredClone(args[2]);
    return Promise.resolve(structuredClone(args[2]));
  }
  if (key === "collections.delete" && args[0] === "autoDrafterGeneratedDrafts") {
    const records = window.__smokeCollections?.autoDrafterGeneratedDrafts || [];
    window.__smokeCollections.autoDrafterGeneratedDrafts = records.filter(record => record.id !== args[1]);
    return Promise.resolve({ok:true});
  }
  if (key.startsWith("collections.") && args[0] === "autoDrafterCustomProducts" && key !== "collections.list") {
    const collections = window.__smokeCollections ||= {};
    const rows = (collections.autoDrafterCustomProducts ||= []).filter(row => row.id !== (key === "collections.create" ? args[1].id : args[1]));
    if (key !== "collections.delete") rows.push(structuredClone(key === "collections.create" ? args[1] : args[2]));
    collections.autoDrafterCustomProducts = rows;
    return Promise.resolve(key === "collections.delete" ? {ok:true} : structuredClone(rows[rows.length - 1]));
  }
  if (["collections.create", "collections.update"].includes(key) && ["rmas", "pvManufacturers"].includes(args[0])) {
    const collections = window.__smokeCollections ||= {};
    const rows = collections[args[0]] ||= [];
    if (key === "collections.create") {
      const saved = {...args[1], id: args[1]?.id || `smoke-${rows.length}`, updated_date: new Date().toISOString()};
      rows.push(saved);
      return Promise.resolve(structuredClone(saved));
    }
    const index = rows.findIndex(row => row.id === args[1]);
    if (index < 0) return Promise.reject(new Error("Record not found"));
    if (args[3] && Object.hasOwn(args[3], "expectedUpdatedDate") && rows[index].updated_date !== args[3].expectedUpdatedDate) {
      return Promise.reject(new Error("This RMA changed while you were editing. Reopen it before saving."));
    }
    rows[index] = {...rows[index], ...args[2], updated_date: new Date().toISOString()};
    return Promise.resolve(structuredClone(rows[index]));
  }
  if (key === "collections.list" && window.__smokeCollections?.[args[0]]) return Promise.resolve(structuredClone(window.__smokeCollections[args[0]]));
  if (key === "collections.list") return Promise.resolve(args[0] === "users" ? USERS :
    args[0] === "supervisorReportTables" ? window.__smokeWorkTables || [] : []);
  if (key === "quotes.list") return Promise.resolve(window.__smokePaidQuotes || []);
  if (key === "tasks.list") return Promise.resolve(window.__smokeTasks || []);
  if (key === "quotes.get") return Promise.resolve((window.__smokePaidQuotes || []).find(quote => quote.id === args[0]) || null);
  if (key === "quotes.update") return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (window.__smokeQuoteSaveFail) {reject(new Error("Could not persist quote")); return;}
      const index = window.__smokePaidQuotes.findIndex(quote => quote.id === args[0]);
      const record = {...window.__smokePaidQuotes[index],...args[1],_rev:(window.__smokePaidQuotes[index]._rev || 1)+1};
      window.__smokePaidQuotes[index] = record;
      resolve(structuredClone(record));
    }, window.__smokeQuoteSaveDelay || 0);
  });
  if (key === "largeTables.get") return Promise.resolve(window.__smokeLargeTables?.[args[0]] || null);
  if (key === "updater.getState") return Promise.resolve(null);
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
  if (key === "chat.reactions") return Promise.resolve({ok: true, reactions: {}});
  if (key === "chat.emojis") return Promise.resolve({ok: true, emojis: [{id: "c".repeat(64), name: "pepe-pray"}]});
  if (key === "chat.getEmoji") return Promise.resolve({ok: true,
    dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"});
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
  if (key === "sops.sync" && window.__smokeRmaSopRefreshFail) return Promise.resolve({ok:false,error:"SOP refresh unavailable"});
  if (key === "sops.list") return Promise.resolve([...(window.__smokeSopDocs || SOPS)]);
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
