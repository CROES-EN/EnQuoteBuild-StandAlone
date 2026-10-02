# EnQuote — Developer Notes
to run as host: **node webhook-receiver.cjs**

## Build / Test / Publish Workflow — Dev → Test → Ship

Think of this as three tiers, in order. Almost everything you do lives in Tier 1.

### Tier 1: Fast iteration (use this 90% of the time)

| Command | What happens | When to use it |
|---|---|---|
| `npm run desktop:dev` | Starts a live Vite server + opens Electron pointed at it. Most code changes appear **instantly**, no restart needed. | Your default for basically everything — any UI tweak, logic fix, layout change. Start here. |

**Mental model:** "just let me see my change." `app.isPackaged` is always `false` here, so anything gated behind "only do this in a real install" (like DevTools auto-opening) will **still show up here even after it's fixed** — that's expected, not a sign the fix failed.

### Tier 2: "Does this behave correctly as a real installed app?"

| Command | What happens | When to use it |
|---|---|---|
| `npm run desktop:installer:test` | Builds a **real, complete installer** locally into `release\`. Nothing uploaded anywhere — `--publish never`. Slower (a minute or two). | Only when you need to check something that's *specifically* different in a packaged build — DevTools not opening, auto-updater config, the app icon, etc. |

**Mental model:** "let me pretend I'm a user who just installed this." Running the command isn't the test by itself — you then have to actually **launch the `.exe`** it produces inside `release\`.

### Tier 3: Actually shipping it

| Command | What happens | When to use it |
|---|---|---|
| `$env:GH_TOKEN = "your_token"` then `npx electron-builder --publish always` | Builds **and uploads** the installer + `latest.yml` to a new GitHub Release (as a draft). | Only when you're confident everything works and you're ready for your team to receive it. |
| Click **Publish release** on GitHub | Makes the draft visible/live. | Required every time — drafts are invisible to `electron-updater` and to anyone just browsing releases. |

**Mental model:** "no easy going back" step. Always do Tier 1 (and Tier 2, if relevant) first.

### The one-sentence version
> **Dev → Test → Ship.** `desktop:dev` while working, `desktop:installer:test` to sanity-check packaged-only behavior, `--publish always` + Publish only when it's really time to send it out.

---

## Important gotchas

### `app.isPackaged` is `false` for ANY unpackaged run
`npm run desktop`, `npm run desktop:dev`, and `npm run desktop:local` are **all** "unpackaged" as far as Electron is concerned — even if you ran `npm run build` first. `app.isPackaged` only becomes `true` for:
- The real installed `.exe`
- The unpacked build in `release\win-unpacked\`
- Output from `desktop:installer:test` or a real publish

So anything gated behind `if (!app.isPackaged)` (like auto-opening DevTools) will **always** still fire under Tier 1 commands — that's expected, not a bug. The only valid way to test packaged-only behavior is Tier 2 or later.

### Always build/test with an explicit `local` data source
A bare `npm run build` (no env var set beforehand) can silently fall through to real Base44 auth mode instead of local mode, causing errors like:
```
Query data cannot be undefined... Affected query key: ["currentUser"]
```
To avoid this, use:
```powershell
npm run desktop:local
```
This explicitly forces `VITE_DATA_SOURCE=local` before building.

---
## Process Before running npxnpx electron-builder --publish always

Make sure Enquote is CLOSED before creating a fresh build:
`Get-Process | Where-Object { $_.ProcessName -like "*EnQuote*" }`

If that returns anything, force-close it:
`Get-Process | Where-Object { $_.ProcessName -like "*EnQuote*" } | Stop-Process -Force`

Then re-check to confirm it's actually gone (should return nothing):
 `Get-Process | Where-Object { $_.ProcessName -like "*EnQuote*" }`

 Then run 
`Remove-Item -Recurse -Force "C:\EnQuoteBuild\dist" -ErrorAction SilentlyContinue`
`Remove-Item -Recurse -Force "C:\EnQuoteBuild\release" -ErrorAction SilentlyContinue`
`npm run build`
`git status`
`git add`

## Release Process (Recap)
1. Bump `"version"` in `package.json` (e.g. `1.0.1` → `1.0.2`)
2. `$env:GH_TOKEN = "your_token_here"` (session-only, never commit this)
3. `npx electron-builder --publish always`
4. Go to the new draft release on GitHub → click **Publish release** (drafts are invisible to `electron-updater`)
5. Share `https://github.com/CROES-EN/EnQuoteBuild-StandAlone/releases/latest` with the team — always points to the newest published release

---

## Known Issues / TODO
- [x] Theme settings per signed-in user (fixed — see userScopedStorage.js)
- [x] Column/tile/summary-field/goal preferences per signed-in user (fixed)
- [x] Sign-in name field not accepting typed input (fixed — rebuilt without Popover+cmdk)
- [x] "Incorrect password" showing raw IPC error text (fixed — cleaned up in AuthContext.jsx)
- [x] Team-wide "who's signed in / last signed in when" view (not yet built — would need a
      write-back-to-Base44 path for local sign-in activity, similar to the outbound quote sync)
- [x] DevTools auto-open fix — confirmed correct in code, but only verifiable via Tier 2/3 testing (a Tier 1 run will always still show it)
- [x] Fix ICON for APP
- [x] Specific Quote Notifications
- [x] Auto-Quote Drafter - Pulls from Quote Request Cases with Case Comments and builds Quotes and places them in "AI Generated Quote - Needs Review" status.
- [x] Add another status for On-Demand Quotes for Shane Mosley which integrates the Material Orders tab & allows Shane to order the purchased quote materials before we schedule.
- [x] Add a new status page after H/O Approved which pulls Material Order window page to allow for bulk material orders for the quote.
- [x] Fix the Resource Planner for mapping FST's to SV's
- [x] Fix updater so that it does not open the app until the download is complete. Provides a cleaner outlook on the application while we move between versions.
- [ ] ANIMATED THEMES??
- [ ] Hyperlinks for Case Numbers & Site ID's in Workload

Remove-Item -Recurse -Force "C:\EnQuoteBuild\release" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "C:\EnQuoteBuild\dist" -ErrorAction SilentlyContinue
git status
git add -A
git commit -m "**notes go here**"
git push origin master  
npm run build
npx electron-builder --publish always

---

## Hotfixes without a full release (UI hotfix channel)

Most fixes only touch the UI (`src/`). Those can go out in about a minute, with no new installer:

```powershell
npm run publish:ui -- --notes "What changed, shown to people in the update banner"
```

It checks that `electron/` and `package.json` are identical to the released tag (otherwise it stops: that
needs a full release), builds, smoke-tests every page, signs the update with `_private\ui-signing-key.pem`
(**back this file up - without it you can't publish UI updates**), uploads it to the Worker and verifies it
downloads back intact. Installed copies pick it up within ~15 minutes (or on next launch) and show a
"Reload now / Later" banner. A downloaded UI that fails to load is discarded automatically and the bundled
UI takes over.

| Command | What it does |
|---|---|
| `npm run publish:ui -- --notes "..." --channel beta` | Testers only. A tester opts in by putting `beta` in `ui-channel.txt` in their app data folder. |
| `npm run publish:ui -- --promote` | Releases the current beta UI to everyone. |
| `npm run publish:ui -- --withdraw` | Stops offering the update (installed copies keep what they have). To undo a bad one, publish a fixed UI. |
| `npm run smoke` | Loads the built `dist\` in a hidden window and visits every page; fails on any crash, error screen or console error. Also runs inside the full release. |
| `npm run errors` | Shows error reports sent by installed apps (grouped, with counts and who hit them). Options: `-- --days 1 --limit 20`. |

Anything in `electron/` (main process, preload, sync code) still needs a full release (`node scripts\release-windows.cjs`).

**Installer updates** now download quietly in the background; people see a "Restart now / Later" notice and the update
also installs when they close EnQuote. Failed checks retry after 2, 4 and 6 minutes, and the app checks again when you
come back to its window.

**Roles** are synced from Base44 through the Worker (`/api/users`) at sign-in and every 10 minutes, so a new install
knows who is an admin. `Grant-EnQuoteRole.ps1` is no longer needed.
