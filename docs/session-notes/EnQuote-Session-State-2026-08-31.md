# EnQuote — Session State Snapshot (2026-08-31)

## Current confirmed-good production state
- **Production URL:** https://enquote.base44.app
- **Production App ID:** 6979390a3f44099ffca06859
- **Sandbox URL:** https://en-quote-stand-alone-fa88cf04.base44.app
- **Sandbox App ID:** 6a91e7bce36dd777fa88cf04
- **Working project folder:** C:\EnQuoteBuild (NOT OneDrive-synced -- confirmed this avoids the
  electron-builder EPERM file-lock issue. OneDrive folder and Desktop are both redirected into
  OneDrive sync on this machine -- confirmed via HKCU User Shell Folders registry check.)

Production was verified working via a **plain incognito browser tab** (not the Electron desktop
app) at https://enquote.base44.app/CreateQuote, showing:
- "Quote Draft Agent" button (sparkles icon) -- NOT "AI Assistant"
- No `e.filter is not a function` crash
- Real production Quotes/Products data loading correctly (not "Local Demonstration Data")

## Fixes applied and confirmed live on production today

### 1. Quote Draft Agent feature (the whole point of today's session)
- Replaces the old `QuoteAIAssistant.jsx` component (deleted, no remaining references)
- Lives in `src/features/quoteDraftAgent/`: `QuoteDraftButton.jsx`, `draftEngine.js`,
  `productCatalog.js`, `quoteRequestTextParser.js`, `quoteDraftMapper.js`, `quoteDraftPrompt.js`
- Wired into `src/components/quotes/QuoteForm.jsx` (shared by CreateQuote.jsx and
  EditQuote.jsx/QuoteDetails.jsx)
- 100% local/client-side matching engine -- no LLM or API calls for the core logic

### 2. Data-source / demo-mode bug (build pipeline issue)
- Root cause: a **shell-level environment variable** `VITE_DATA_SOURCE=local` was set in one
  PowerShell session and silently overrode `.env.local`'s `VITE_DATA_SOURCE=base44` at build
  time, no matter what the file said. Confirmed via `Get-ChildItem Env: | Where-Object Name -like
  "*VITE*"`. Cleared with `Remove-Item Env:VITE_DATA_SOURCE`.
- **Also**: `base44 deploy --build` (the CLI's own internal build step) was unreliable --
  possibly due to Electron/desktop-project auto-detection given `package.json`'s
  `"main": "electron/main.cjs"` and `desktop:*` npm scripts that explicitly set
  `VITE_DATA_SOURCE=local`. The reliable pattern is: always run a **plain** `npm run build`
  yourself, verify the output, THEN deploy with `--no-build`.

### 3. `getProducts`/`getQuotes` response-unwrap bug (blank Create Quote page)
File: `src/api/adapters/base44Adapter.js`
Production's `getAllProducts`/`getAllQuotes` backend functions return `{ products: [...] }` /
`{ quotes: [...] }` (wrapped), not a bare array. Fixed by unwrapping defensively:
```js
getQuotes: async () => {
  const response = await base44.functions.invoke("getAllQuotes");
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.quotes)) return data.quotes;
  return [];
},
getProducts: async () => {
  const response = await base44.functions.invoke("getAllProducts");
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  return [];
},
```
**CONFIRMED RESTORED AND LIVE as of this session's final fix.**

### 4. HashRouter query-param bug ("Quote not found" on Quote Details)
The app uses `<HashRouter>` (`src/App.jsx`), so real URLs look like
`https://enquote.base44.app/#/QuoteDetails?id=abc123`. `window.location.search` only reads the
query string of the real path -- NOT the part after `#` -- so it was always empty, making
`quoteId` always `null`. Fixed in 6 files by switching to React Router's `useLocation().search`:
- `src/pages/Boneyard.jsx`
- `src/pages/EditQuote.jsx`
- `src/pages/InactiveCollections.jsx`
- `src/pages/QuoteDetails.jsx`
- `src/pages/QuoteOverview.jsx`
- `src/pages/Quotes.jsx`
**CONFIRMED working (quotes create/open correctly).**

### 5. Mojibake encoding fixes
Corrupted UTF-8-as-Latin-1 sequences fixed across `AuthContext.jsx`, `Boneyard.jsx`,
`QuoteDetails.jsx`, `QuoteOverview.jsx`, `Quotes.jsx`: "Ã—" -> "×", "â€"" -> "—", "â€¦" -> "…".

### 6. Critter guard pricing bug (draftEngine.js) -- STATUS: NEEDS RE-VERIFICATION
A real quote request for 297 ft of critter guard wire priced at **$91,146.50** instead of
~$470, due to: (a) no unit conversion (ft treated as roll-count), (b) a duplicate-match bug
picking the same expensive roll-kit SKU twice, (c) a runaway miscellaneous-service fallback
multiplying 297 x $265 with no cap.

Fix written and applied earlier today (added `extractCoveragePerUnit`, precision-based tie
breaker, linear-unit fallback cap, `deduplicateItems`) -- but during later troubleshooting of an
unrelated Electron desktop-app caching issue, **`draftEngine.js` was rolled back to its
pre-fix `.bak` version, then restored again from a preserved timestamped copy**
(`draftEngine.js.before-rollback-<timestamp>`). The LAST build+deploy in this session restored
and verified the `base44Adapter.js` fix specifically, but did **not** explicitly re-verify the
critter-guard fix signature (e.g. `extractCoveragePerUnit`) in that final deployed bundle.
**ACTION ITEM for next session: re-run the critter guard test request and/or explicitly grep
the live production bundle for `extractCoveragePerUnit` to confirm this fix is actually live.**

## Known unresolved / deprioritized issue
**Electron desktop app (`EnQuote Demo.exe`) shows stale content intermittently.** Root cause
found: the desktop app's `electron/main.cjs` does NOT purely load local packaged files -- once
the local page boots, the app's own client-side auth/navigation logic redirects the entire
Electron window to the **live** `https://enquote.base44.app` URL (confirmed via
`location.href` in the app's own DevTools console). This means the "desktop app" is really a
thin Electron wrapper around the live website for auth purposes, and is therefore subject to
whatever caching Electron's networking stack does for that live fetch, SEPARATE from:
- Regular browser cache (different profile/session)
- `%APPDATA%\EnQuote Demo` (checked, cleared, did not help)
- The REAL Electron userData cache, `%APPDATA%\base44-app` (per `package.json`'s internal
  `"name": "base44-app"`, not the product name) -- also checked and cleared, did not
  conclusively resolve it either.
Multiple full uninstall/reinstall/reboot cycles did not resolve this. Deprioritized in favor of
using a plain browser (incognito, "Disable cache" checked in Network tab) as the reliable way to
test/verify production during active development. Revisit only if the desktop app is a firm
long-term requirement -- likely candidate root cause is Electron's own session-level HTTP
cache/service-worker registration for the live URL, not yet fully isolated.

## Desktop installer (Windows)
- Version: bumped to **0.1.1** in `package.json` for this session's hotfix (previously 0.1.0).
  Recommend continuing to bump the patch version for every future desktop rebuild.
- Build command (from C:\EnQuoteBuild, NOT the OneDrive folder):
  ```powershell
  npm run build
  npx electron-builder --win --publish never
  ```
- Output: `.\release\EnQuote-Setup-<version>.exe`
- Installs to `%LOCALAPPDATA%\Programs\EnQuote Demo\` (per-user install, `perMachine: false`)
- No auto-update mechanism configured yet. Every fix requires: rebuild -> new installer ->
  manually redistribute to beta testers -> they re-run the installer (upgrades in place, no
  uninstall needed). Considered but deferred: `electron-updater` + GitHub Releases (or similar
  static host) for real auto-updates -- worth revisiting if the desktop app proves to be a
  long-term requirement rather than primarily a browser-based tool.

## The one reliable deploy recipe (use this every time going forward)
```powershell
cd C:\EnQuoteBuild

# 1. Force correct production values into .env.local explicitly (don't trust whatever's there)
Copy-Item .\.env.local .\.env.local.bak -Force
@"
VITE_DATA_SOURCE=base44
VITE_BASE44_FUNCTIONS_VERSION=prod
VITE_BASE44_APP_BASE_URL=https://enquote.base44.app
VITE_BASE44_SERVER_URL=https://base44.app
VITE_BASE44_APP_ID=6979390a3f44099ffca06859
"@ | Set-Content .\.env.local

# 2. ALWAYS check for and clear the rogue shell env var first
Get-ChildItem Env: | Where-Object Name -like "*VITE*"
Remove-Item Env:VITE_DATA_SOURCE -ErrorAction SilentlyContinue

# 3. Clean rebuild (never trust base44 deploy --build; always build yourself first)
Remove-Item -Recurse -Force .\node_modules\.vite -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\dist -ErrorAction SilentlyContinue
$NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
& "$NodePath\npm.cmd" run build

# 4. VERIFY before deploying -- never skip this step
Select-String -Path .\dist\assets\*.js -Pattern '\["mock","local","salesforce-mock"\]\.includes\(([^)]*)\)'
Select-String -Path .\dist\assets\*.js -Pattern "6979390a3f44099ffca06859" -Quiet   # should be True
Select-String -Path .\dist\assets\*.js -Pattern "6a91e7bce36dd777fa88cf04" -Quiet   # should be False

# 5. Only after verification passes, deploy with --no-build
base44 deploy --app-id 6979390a3f44099ffca06859 --no-build --yes

# 6. Restore .env.local for local dev (points back at sandbox)
Copy-Item .\.env.local.bak .\.env.local -Force
```

To deploy the same fixes to sandbox instead, swap in:
```
VITE_BASE44_APP_BASE_URL=https://en-quote-stand-alone-fa88cf04.base44.app
VITE_BASE44_APP_ID=6a91e7bce36dd777fa88cf04
```
and `base44 deploy --app-id 6a91e7bce36dd777fa88cf04 --no-build --yes`.

## Files/backups worth knowing about in C:\EnQuoteBuild
- `src\api\adapters\base44Adapter.js.bak` -- pre-unwrap-fix version (do not restore; superseded)
- `src\features\quoteDraftAgent\draftEngine.js.bak` -- pre-critter-guard-fix version (do not
  restore; superseded)
- `*.before-rollback-<timestamp>` files -- the preserved POST-fix versions saved right before
  the rollback script ran; these are what got restored back into place at the very end of this
  session
- `.env.local.sandbox-backup`, `.env.local.before-*.bak` -- assorted env snapshots from today,
  safe to ignore/clean up once things are stable

## Immediate next steps for the next session
1. Re-verify the critter guard pricing fix is actually live on production (grep for
   `extractCoveragePerUnit` in the deployed bundle, and/or re-run the exact critter guard test
   request through the UI and confirm ~$470 total, not $91,146.50).
2. Decide whether to invest in real desktop auto-updates (electron-updater) or standardize on
   the browser as the primary interface, given the unresolved Electron caching mystery.
3. Consider setting up a proper git repository for this project if one doesn't already exist --
   today's session relied entirely on manual `.bak` file copies for version safety, which is
   fragile (as demonstrated by the rollback confusion) compared to real version control.
