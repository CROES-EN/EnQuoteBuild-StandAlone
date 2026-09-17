# EnQuote — Developer Onboarding & Working Manual

This document explains how EnQuote is actually built, tested, and shipped — written from real
experience fixing this app, not theory. If you're new to this project (hi, Shane), read this
start to finish before touching `main.cjs` or `repository.cjs` specifically — those two files
have caused the most subtle, hard-to-diagnose bugs, and this doc explains why.

---

## 1. What EnQuote Is

A desktop app (Electron + React + Vite) for managing solar O&M service quotes. It's
**local-first**: every user's copy keeps its own local JSON data file on their own PC, and syncs
with Base44 (the cloud source of truth for quotes) via webhooks. 

**Shared data (same for everyone on the team, by design):** quotes, products, imported
Salesforce/Workload report data. This is the whole point of the app — one shared source of
truth instead of scattered spreadsheets.

**Per-user data (isolated per signed-in person, on purpose):** theme, Workload tile
customization, column order/visibility, "My Cases" name, Workload goal, Salesforce login
session. These are personal display/workflow preferences or credentials — never shared.

---

## 2. Environment Setup (first time only)

1. Install Node.js (match whatever version is already working — check with the current dev if
   unsure) and Git.
2. Clone the repo:
   ```
   git clone https://github.com/CROES-EN/EnQuoteBuild-StandAlone.git
   cd EnQuoteBuild-StandAlone
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Get a `GH_TOKEN` (a GitHub Personal Access Token) if you'll ever need to publish a release
   yourself — see Section 6. **Never paste this token into a chat tool, commit it to a file, or
   share it anywhere other than directly setting it as an environment variable.** Treat it
   exactly like a password — anyone with it can publish releases under the account that
   generated it.

---

## 3. The Golden Rule: Dev → Test → Ship

Everything you do falls into one of three tiers. You will spend 90%+ of your time in Tier 1.

### Tier 1 — Fast iteration (your default)
```
npm run desktop:dev
```
Starts a live Vite dev server + Electron pointed at it. Most code changes hot-reload instantly —
no restart needed for most renderer (React) changes.

**Important quirk:** `app.isPackaged` is always `false` here — even if you ran `npm run build`
first. Anything gated behind `if (!app.isPackaged)` (like DevTools auto-opening only in dev)
will **always** still behave like dev mode under this command. That's expected, not a bug.

**Another important quirk:** if you copy/replace a `.jsx` or `.js` file *while* `desktop:dev` is
running, you can hit a real Vite error like:
```
[vite] Internal server error: EBUSY: resource busy or locked, open '...'
```
This happens when a file write and Vite's file-watcher collide. When this happens, the running
app can end up in a half-updated, buggy-looking state (fields not responding, stale behavior)
that has nothing to do with your actual code change. **Always fully stop the dev server before
copying in changed files, then restart clean:**
```
# stop it (Ctrl+C in that terminal, or if it's stuck:)
taskkill /F /IM electron.exe
taskkill /F /IM node.exe

# THEN copy your files, THEN:
npm run desktop:dev
```

### Tier 2 — "Does this behave correctly as a real installed app?"
```
npm run desktop:installer:test
```
Builds a real, complete installer locally into `release\`. Nothing is uploaded anywhere
(`--publish never`). Use this ONLY when you need to verify something that's specifically
different in a packaged build — most commonly `app.isPackaged`-gated behavior (DevTools,
auto-updater). Running the command is not the test by itself — you then have to actually
**launch the `.exe`** it produces inside `release\`.

### Tier 3 — Actually shipping it
```
$env:GH_TOKEN = "your_token_here"
npx electron-builder --publish always
```
Builds **and uploads** the installer + `latest.yml` to a new GitHub Release — as a **draft**.
You must then manually go to the release on GitHub and click **Publish release** — drafts are
invisible to `electron-updater`, so this step is not optional.

---

## 4. Project Structure — What Lives Where

| Path | What it is |
|---|---|
| `src/` | React renderer code (pages, components, features) |
| `electron/main.cjs` | Electron main process — window creation, IPC handlers, auto-updater config |
| `electron/preload.cjs` | The ONLY bridge between the renderer and main process — defines every `window.enquoteLocal.*` API |
| `electron/repository.cjs` | The local JSON data file's entire read/write/schema logic — **see Section 5, this file requires extra care** |
| `electron/salesforceImport.cjs` | The embedded Salesforce login/import window |
| `src/lib/userScopedStorage.js` | Shared helper for making any localStorage preference per-signed-in-user |
| `src/lib/AuthContext.jsx` | Local sign-in/sign-out logic, session persistence |
| `package.json`'s `"build"` field | electron-builder's config (installer settings, GitHub publish target) |

---

## 5. Files That Require Extra Care (learned the hard way)

### `electron/repository.cjs`
This file has a **Zod schema** (search for `z.object({...}).parse(...)`) that validates data
before every write — including every write triggered by a Base44 sync. **Zod silently strips
any field not explicitly listed in that schema.** We lost real Workload/Supervisor Dashboard
data for hours because two collection names existed everywhere else in the file but were
missing from this one schema. **If you ever add a new local-only collection, you MUST add it to
this schema too, or it will be silently deleted on the next sync.**

### `electron/main.cjs`
- The `createWindow()` function has a fallback: if `http://localhost:5173` isn't reachable, it
  silently loads the old, possibly-stale `dist/index.html` build instead. If something is
  behaving like "old code," check for this fallback firing before assuming a bug in your fix.
- `configureAutoUpdater()` and DevTools auto-open are both correctly gated behind
  `app.isPackaged` — don't remove that check, and don't expect to test it via `desktop:dev`.

### Any `localStorage`-based preference file (e.g. `themeStore.js`, `workloadPreferences.js`)
**Never write a "migrate the old shared value forward" step when adding per-user scoping.** We
built one, and it caused a real bug: a second person signing in for the first time silently
inherited the FIRST person's prior preference (and in one case, their *identity* — "My Cases"
showed the wrong person's cases). Every per-user preference should start from a clean default
until that specific person sets their own value. See `userScopedStorage.js`'s own comments for
the full story.

### `electron/salesforceImport.cjs`
The embedded Salesforce login window uses an Electron **session partition** to keep its login
cookies separate from the rest of the app. This partition name MUST be built per-signed-in-user
(see `buildSalesforcePartitionName`) — a single shared partition means whoever logs into
Salesforce first is silently "remembered" for every other person using the feature on that PC.

---

## 6. Publishing a Release — Step by Step

1. Bump `"version"` in `package.json` (e.g. `1.0.2` → `1.0.3`). Every release needs a new,
   higher version number — electron-updater compares version numbers to decide if an update
   exists.
2. Get a `GH_TOKEN`:
   - GitHub → profile picture → Settings → Developer settings → Personal access tokens →
     Tokens (classic) → Generate new token (classic)
   - Check only the **`repo`** scope
   - Copy the value **immediately** — GitHub only shows it once
3. In your terminal:
   ```
   $env:GH_TOKEN = "paste_your_token_here"
   npx electron-builder --publish always
   ```
4. Go to `https://github.com/CROES-EN/EnQuoteBuild-StandAlone/releases`, open the new draft,
   confirm it has all 3 files attached (`EnQuote-Setup-X.X.X.exe`, `.exe.blockmap`,
   `latest.yml`), then click **Publish release**.
5. Share the "always latest" link with the team so nobody needs a new link every release:
   ```
   https://github.com/CROES-EN/EnQuoteBuild-StandAlone/releases/latest
   ```

**Before publishing anything:** always do a Tier 1 test, and ideally a Tier 2 test too. Don't
skip straight to Tier 3.

---

## 7. Safe Patching Pattern (how we fixed bugs all night)

When making a risky or structural change (schema changes, IPC wiring, anything in
`main.cjs`/`repository.cjs`), follow this pattern instead of hand-editing directly:

1. **Read the exact current file content first** — don't assume it matches what you remember or
   what's in an old chat/doc. Files drift.
2. **Back up before writing** — a simple timestamped copy
   (`file.ext.backup-20260101-120000`) costs nothing and has saved this project multiple times.
3. **Verify after writing** — re-read the file and confirm the expected change is actually
   present (a search/`Select-String` check), plus a syntax check (`node --check file.cjs` for
   any `.cjs` file) before considering it done.
4. **If a change doesn't take effect, don't assume the logic is wrong before confirming the file
   was actually deployed correctly** — several "still broken" reports tonight turned out to be a
   file that was never actually copied to its real location, or a stale Vite dev-server cache
   (see Section 3's EBUSY note).

---

## 8. A Note on Access & Trust

Since Shane will have direct git push access and the `GH_TOKEN`, a few practical norms worth
agreeing on as a team before it's needed:
- Test any change via Tier 1 (and Tier 2, if it touches `main.cjs`/auto-updater/packaging)
  before pushing to `main`.
- Treat `GH_TOKEN` like a password — never commit it, never share it outside a direct,
  person-to-person handoff.
- For anything touching `repository.cjs`'s schema or `main.cjs`'s window/IPC logic, do a quick
  sanity read of Section 5 first — these are the two files that have caused real, hard-to-spot
  data-loss bugs in this project's history.

