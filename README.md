# enquote-sync — Final Version (all fixes applied)

## Release validation

Before a desktop release, run `npm run lint`, `npm run typecheck`, then build
with `npm run build` and validate the renderer with `npm run smoke`.
Lint checks application, Electron, Worker, scripts and tests; generated builds,
dependency caches, backup directories and nested development repositories are
excluded. The React configuration uses Vite's automatic JSX runtime.
The **Release EnQuote Windows update** VS Code task requires a clean working
tree (including the index); commit the intended source changes before running it.

## macOS installer update recovery

The current macOS workflow builds without a Developer ID certificate, so Apple's
Squirrel.Mac installer (used by electron-updater) cannot install updates. Instead,
unsigned Macs self-install (`electron/macSelfInstaller.cjs`): electron-updater
downloads the ZIP and verifies its sha512 from `latest-mac.yml`, EnQuote unpacks
it, and a detached script waits for EnQuote to exit, swaps the app bundle (rolling
back if the copy fails), clears quarantine, and relaunches. The installer log is
`~/Library/Logs/EnQuote/enquote-mac-update.log`. A **Download update** notice is
shown instead when the app runs from a disk image or App Translocation, or when
the user cannot modify the installed app.
For supported automatic installations, installer errors and a 90-second
installation timeout release the startup gate rather than leaving the splash
open indefinitely. Update failures remain visible in the app.

If an older Mac installation is stuck on **Installing update**, fully quit EnQuote
(Command-Q, or Force Quit if necessary), download the appropriate Mac DMG from
[the latest release](https://github.com/CROES-EN/EnQuoteBuild-StandAlone/releases/latest),
replace EnQuote in Applications, eject the DMG, and open the Applications copy.
Use arm64 for Apple Silicon or x64 for Intel. Do not delete Application Support
or other EnQuote user-data folders. An IT-managed installation may require IT
to perform the replacement. Native updater fixes require a full desktop release;
a UI-only update cannot repair the installed startup code.

Installations older than the self-installer (1.4.2 and earlier) need one manual
replacement to transition. While macOS users are on 1.3.x, `latest-mac.yml` may be
withheld from a release so their startup update check fails cleanly instead of hanging.

## EnQuote personal settings and Salesforce workspace

### Remembered filters and views

Applied filters and view selections are saved per signed-in user on this device,
so navigating away, reloading the UI, or reopening EnQuote does not reset them.
Only small view settings are saved: pages still unmount and data still refreshes.
These settings are not shared team data or synced across devices.

- **Quotes:** search, status, coordinator/submitter, sort, My Quotes, Alerts,
  Duplicates, Golden Quotes and status-summary expansion.
- **Workload:** search, sort, My/All Cases, tile/Review Me and all applied column
  checkbox filters (including an explicitly empty selection). Existing Clear
  controls remove the saved filters too. Shared-case links temporarily bypass
  the normal Workload filters without overwriting them.
- **Supervisor:** selected tab/date and completed statuses; individual imported
  report tables remember their own search and sort independently.
- **Quote Dashboard:** period/custom dates, status, search, inclusion toggles and view.
- **SLA Reporting:** date range and selected tab.
- **Auto-Drafter, Dashboard, Products, Material Orders, Panel RMAs, Rejection
  Reviews, Boneyard and Site Flags:** their search/filter/view selections.
- **Tasks:** selected tab and Show Completed.

In **Supervisor → Hourly Wait Time Summary**, choose **Compare Two Days** to
select two independent Mountain Time dates (for example Monday and Friday).
Only those dates are displayed; intervening days are excluded. Both selections
are remembered per user. The **Quotes Requested** tile uses the same imported
request rows and exclusions as Auto-Drafter's **Quote Requests** category:
one entry per case, excluding cases with an existing quote or a manual removal.

Desktop **Users → Create User** assigns an EnQuote role by company email through
the admin access service. It does not send an invitation or create a password;
company-login access is still required. Desktop role editing does not change
profile details. Hosted Base44 installations retain their invitation controls.
Failed saves keep the create form populated for retry.

**Resource Planner → FST Roster** shows how precisely each FST's home and ship-to
address was located: *Located* (street match), *Pinned* (set by hand), *ZIP only*
(drive times are approximate), *Not found*, or *Not checked*. **Check locations**
looks up every unchecked active address and reports any lookups that failed;
**Needs pin** filters to ZIP-only and not-found addresses. In the edit dialog,
**Set pin on map** lets you click or drag the pin onto the exact home or storage
unit, or paste coordinates / a Google Maps link. Pins are used for drive-time
ranking until the address text changes (for example when an FST moves); the new
address is then located again on save. Save waits for in-progress lookups, and
failed lookups or saves are shown instead of being skipped silently.

Explicit quote-status links still override the remembered status. The old
unscoped Quotes filter key is not migrated because it may belong to another user.
Dialogs, unsaved business forms, bulk selections and live data are not cached.
Storage failures are logged and leave the current screen usable.
After building, `npm run smoke -- --view-state-only` checks real page navigation,
Workload column-filter restoration and user isolation.

Open **Settings** in EnQuote to choose Salesforce case-link behavior, show/hide the
floating Salesforce cloud launcher, and show/hide sidebar tabs. Preferences are saved
per signed-in EnQuote user on the current device. Settings cannot hide itself; hiding
other tabs affects desktop/mobile navigation only, not access permissions or direct links.
Existing drag-to-reorder behavior is preserved.

In the updated desktop app, case links default to a borderless **Salesforce side panel**
inside EnQuote. Clicking another case opens/navigates the panel. Click the floating cloud
to slide it out from the right or tuck it away without losing the current Salesforce page.
Focus view opens wide by default, with a dimmed EnQuote background and a slim toolbar
above Salesforce. Expand/Restore switches between focus width and your saved narrower
width without reloading Salesforce. The toolbar also has tuck-away and reload buttons.
Click the dimmed background or press Escape to tuck the panel away. Other floating
EnQuote controls sit behind the dimmed layer; the cloud remains accessible.
Drag the panel's left edge to resize it,
or focus the resize handle and press Left/Right; your preferred width is saved per user
on this device and fits the current window. Dragging or keyboard resizing exits expanded
focus width. Salesforce's own search/navigation controls are left intact. Case links use
the case record directly when a Salesforce Case ID is known; otherwise they use search.
Native Salesforce content is hidden while the drawer slides and placed only once the drawer
is settled; a background check re-aligns it if the layout or zoom changes, so the toolbar
and page stay aligned. Because Salesforce is drawn above EnQuote's page, notifications
that appear while the drawer is open are shown in a compact strip inside the drawer, just
above Salesforce, instead of floating behind it; they return to the normal corner position
when the drawer is tucked away.
Unchanged layout checks do not reapply native Salesforce bounds.
New desktop builds use the measured renderer viewport to convert drawer coordinates
to native window coordinates, including when the configured zoom is stale.
When Salesforce is tucked away, its cloud launcher sits below normal dialogs and
sheets instead of covering their controls. It remains above its own drawer when open.
Case scanning reuses DOM traversal, text and computed-style results within each scan
to reduce background work while typing; each later scan still reads fresh case details.
These native performance changes require a full desktop release, not a UI-only update.
The launcher remains accessible beside the panel.
The floating launcher is available throughout signed-in EnQuote pages/windows, alongside
Notifications and Tasks. One isolated Salesforce view is reused: opening it in another
EnQuote window moves the same page there instead of creating another session.
Salesforce console workspace tabs are managed inside Salesforce; EnQuote does not
automatically create subtabs or control an existing Microsoft Edge tab.

The workspace requires its own Salesforce login, shared with EnQuote's existing
report-import session and remembered across restarts until Salesforce expires it or
you sign out. It does not share Edge cookies. Report imports remain separate and do
not close the case workspace or capture its downloads. Browser previews and the
**External browser / new tab** setting use normal external links without replacing
EnQuote; they do not guarantee reuse of an existing browser tab.

The Workload page's Salesforce import button captures CSV/XLS/XLSX exports from
its report window and report-owned child windows, without a Save As dialog.
Unrelated case downloads and PDF attachments retain normal download behavior.
The existing parsing, validation and save flow must succeed before the report
window closes; manual Import Report remains available.

After building the UI, `npm run smoke -- --settings-only` checks Settings and the
floating launcher across pages and two EnQuote windows using an isolated native Salesforce
view with local fixture content in place of network access.
Real Salesforce SSO and console behavior still require testing with your account.

### Customer Copy attachments for Salesforce

While the Salesforce drawer is visible, EnQuote scans the visible case about once
per second, including console tab switches that do not change the URL. After the
case details settle, a unique matching quote reveals **Generate Quote** beside
**Prepare Homeowner Quote** in the toolbar. Click **Generate Quote** to create the
Customer Copy PDF and matching email; scanning alone never generates a document.
Matching prefers the case number;
only when there are no case matches does it fall back to the visible Site ID.
Conflicting case/site data or multiple matches require manual review. If no current
quote matches either identifier, the toolbar says **No Quote Found**.
On a detected case change, the previous PDF is cleared before preparing another;
late generation results are checked against the current case before saving.
Scanning pauses while the drawer is hidden. Switching Salesforce console tabs clears
the old PDF and detects the new case's quote, even if the name editor is open.
The new case still waits for **Generate Quote**. Homeowner overrides reset on case changes.
Tab monitoring continues during slow document generation, and obsolete results are discarded.
The PDF is temporary local staging, not a permanent Downloads copy, and is never
automatically attached, uploaded or sent. Verify the case, homeowner and PDF before use.

The mail button beside the PDF chip (**Copy homeowner email**) copies a plain-text
subject and message for that prepared quote to the clipboard. Paste into Salesforce
and review before sending (move the subject line into the email subject field).
The message uses a conversational Enphase Energy introduction with the signed-in
user's first name when available. The greeting and subject reuse the exact homeowner
name selected for the PDF, including a manual override. The subject format is
`Enphase Energy - On - Demand Quote - Homeowner Name - Site ID`
(the final segment is omitted if no Site ID is available).
On-Demand quotes are identified as such in the body. It reuses the customer-friendly
scope summary generated for that same Customer Copy PDF, without another AI request.
That explanation draws directly from the quote's scope of work: it describes distinct
repairs/replacements and any stated testing, retaining quantities, approximate wiring
lengths, equipment ratings and conditional work. Detailed scopes use roughly 3-5
plain-English sentences in their own email paragraph; simple scopes stay shorter.
It must not invent a diagnosis or turn possible work into a definite replacement.
If that summary is unavailable, the email omits the work description rather than
copying raw internal scope/notes. It asks the homeowner to reply if they want to proceed
so an invoice can be sent, without a pricing table, payment deadline or scheduling promise.
The draft says the quote is attached: attach the PDF before sending. Email content is staged
with the PDF snapshot and cycles/clears with it; clipboard copying never attaches
the PDF or sends an email.
After copying, a brief **Copied to clipboard** popup appears inside the toolbar
so it remains visible above the native Salesforce content.

The dropdown under **Prepare Homeowner Quote** is only needed to change the homeowner
name. It shows the detected case/quote, a name input, filename preview, and **Use detected
name** to undo a manual override. Click **Done** to close it or **Generate Quote** in
the toolbar to generate using that name. Quote matching and generation do not require
opening the dropdown. The editor opens above Salesforce, not behind its native view,
and works from any EnQuote page.
If Salesforce's contact is unavailable, the saved quote homeowner is used. If neither
provides a usable name, **Generate Quote** stays clickable and opens/focuses the name
editor with a visible explanation, rather than becoming an unexplained disabled button.
A name is still required before a PDF can be generated. Disabled generation controls
show their loading/stale-case reason in the toolbar and button tooltip.
Generation creates the existing Customer Copy
PDF (not the internal standard quote), named `Homeowner Name - Quote - Q-reference.pdf`.
The name defaults to the quote's client name (`client_name`) or Auto-Drafter customer
name (`customer`) when available; confirm or enter it rather
than guessing a homeowner from a site/case ID. Invalid filename characters are removed.
Existing PDF download actions are unchanged.

The visible drawer automatically reads labeled **Case Number**, **Contact Name** and
**Enlighten Site ID / Site ID** fields from the visible Salesforce case Details page.
Case links can initially open search results: open the actual case before reading it.
Encoded Salesforce quick-link searches are recognized as search pages and are never
treated as the current case, even if cached case tabs remain in the DOM.
On a `/lightning/r/Case/500.../view` page, the Salesforce record ID helps scope the
reader to that record's rendered details; it is not converted into the numeric case
number. The selected console tab's controlled panel takes precedence over a stale URL.
Plain labeled text outputs are supported alongside Lightning formatted components.
While the drawer is visible, Salesforce navigation and completed toolbar reloads rerun
the lookup automatically, allowing a short wait for Lightning to render its fields.
Generating requires clicking **Generate Quote**; matching alone only fills the detected state.
It uses stable field labels/containers rather than generated `lwc-*` attributes or the
position of numeric fields. Nested Lightning field wrappers and display-contents
outputs are supported; edit/preview controls are not read as field values.
Contact record links remain readable even when Salesforce gives them a button role;
slotted link text is supported and assistive preview text is excluded.
Open shadow roots are traversed; hidden tabs are ignored.
The inspection is local and read-only: it does not click, edit or submit Salesforce.

A single current quote with the exact case number is selected automatically, with a
Site ID consistency check when visible. If no case matches, a unique Site ID match
can be selected instead. Multiple matches require resolving the ambiguity in EnQuote;
**Generate Quote** is unavailable until one quote matches.
The homeowner defaults to the Salesforce contact, then the saved quote name, with a
manual name override available in the dropdown. Salesforce context is read again
before generating with its contact name. Missing, conflicting or inaccessible details
show a message and leave quote/name selection available; there is no guessed contact.
This depends on the org's rendered case layout and requires live verification; closed
shadow roots or changed Salesforce markup may require manual entry.

The Salesforce toolbar displays a draggable PDF chip. Open Salesforce's email attachment
uploader and drag the chip to its file drop area. EnQuote starts a native local-file drag;
Salesforce must accept the drop and finish uploading it. Verify the correct case,
recipient, and attachment before sending. EnQuote does not click Attach or Send and does
not upload through an API. Actual drop support must be verified in your Salesforce org.
If drops are unsupported, the folder icon reveals the prepared PDF so it can be selected
through Salesforce's normal paperclip uploader.

Prepared PDFs are temporary local files, restricted to the preparing EnQuote identity,
replaced when a new PDF is prepared and removed on normal app shutdown. A crash can leave
the temporary file on disk; do not treat preparation as a permanent download or an upload.

## Summary of changes

This version includes all fixes from the 2026-09-29 session:

1. **`updated_date` injection** — `handleEntitySnapshot` now guarantees `updated_date` is present on every record, with a 4-level fallback chain.
2. **Delete propagation** — `upsertBase44EntityState` handles `action: "delete"` by setting `deleted_at` (tombstone). Uses INSERT ... ON CONFLICT so deletes for never-seen records aren't lost.
3. **`record: null` fix** — `handleEnqueue` uses `??` instead of `||` so explicit `null` from delete payloads is respected.
4. **Reconciliation cron** — Every 15 minutes, diffs `base44_entity_state` against Base44's API and tombstones records that no longer exist. Also cleans up `enqueue_request_log` entries older than 7 days.
5. **Request logging** — Every call to `/api/outbound/enqueue` is logged with User-Agent, IP, CF-Ray, and country.
6. **Manual reconcile endpoint** — `POST /api/reconcile` (auth with `SNAPSHOT_TOKEN`).

## D1 migrations

Three migrations are included in `migrations/`:

```bash
npx wrangler d1 execute enquote-sync --file=migrations/001_add_updated_date.sql
npx wrangler d1 execute enquote-sync --file=migrations/002_add_deleted_at.sql
npx wrangler d1 execute enquote-sync --file=migrations/003_create_enqueue_request_log.sql
```

**Note:** All three migrations have already been applied to the production D1 database. Only run them if you're setting up a fresh environment.

## Deployment

```bash
npx wrangler deploy
```

The cron trigger (`*/15 * * * *`) is configured in `wrangler.toml` under `[triggers]`.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/base44/webhook` | HMAC signature | Inbound webhook from local sync |
| GET | `/api/base44/webhook/snapshot` | SNAPSHOT_TOKEN | Full quote snapshot from `quotes` table |
| GET | `/api/base44/webhook/snapshot-meta` | SNAPSHOT_TOKEN | Last sync timestamp |
| POST | `/api/outbound/enqueue` | OUTBOUND_TOKEN | Enqueue entity state (create/update/delete) |
| POST | `/api/inbound/base44` | OUTBOUND_TOKEN | Push to Base44 |
| GET | `/api/base44/webhook/entity-snapshot` | SNAPSHOT_TOKEN | All active entities (excludes tombstoned) |
| GET | `/api/outbound/status` | OUTBOUND_TOKEN | Check outbound push status |
| POST | `/api/reconcile` | SNAPSHOT_TOKEN | Manual reconciliation trigger |
