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

### Quote Draft Agent dependency previews

Step 2's preview supports both curated accessory advisories (`suggestions`
arrays) and generalized dependency advisories (`reason` text with source and
verification details). Both remain visible for review; generalized advice does
not add priced items. This renderer-only fix can ship through the signed UI
update without changing Electron or the installed app version.

### Auto-Drafter: Improper Quote Requests

Use **Mark Improper Request** on a raw case or saved-draft tile, optionally enter
a reason, and confirm. The request leaves **Awaiting Draft** and cannot be
generated or sent to Quotes while marked. Existing saved drafts are retained.
**Improper Requests** provides a searchable, sortable team review list with case
and site links, marking time, reviewer, reason, and **Undo mark**. Undo restores
drafting eligibility only if the case still meets the normal intake criteria and
has no real quote. Marking does not update Salesforce or a real quote's status.

Executive Overview's **Improper Quote Requests** tile counts unique cases marked
during the selected reporting period, including requests whose marks were later
undone. Repeated marks count once per case for Period Total. Daily Average counts
unique cases per local calendar day divided by every day in the period (including
zero-activity days); Latest Day uses the selected period's end. **View contributing
records** shows one sortable row per contributing case, first/last marking times
in the period, latest reviewer/reason, marking-event count, and current state.

Review events are append-only version-1 records with reserved
`quote-request-review:` IDs in the existing shared `supervisorReportTables`
collection, excluded from imported-report listings. Each mark has its own ID;
undo references known active mark IDs rather than rewriting a shared report.
Concurrent unseen marks remain active until reviewed. Reimports, Clear Data,
and Clear Generated Drafts do not erase reviews. Reviewer email is attributed
from the signed-in UI account, not a separately server-verified audit identity.

This uses the released desktop collection bridge and Supervisor sync: no new
installer, Worker endpoint, or database migration is required. Saving confirms
local persistence, not delivery to every PC; marks and undo become team-visible
after desktop sync, including queued offline changes. A PC that has not received
a remote mark can still draft until sync arrives. Browser development stores
reviews only in local storage and does not provide team sync. Review-load errors
pause drafting rather than treating the queue as unmarked.

### Quote edits and outbound identity

Editing a Quote Draft, Quote Missing Details, or legacy draft updates that
record in place and retains its workflow status. Editing a non-draft creates
a submitted revision first, then retires the prior version with a revision
check. Failure to create the replacement must not hide the original quote.
If retiring fails, the error identifies the saved replacement for review.

The desktop outbound envelope carries `localId` and an already-sanitized quote
payload (`id` removed, `local_quote_id` included). The Worker reconstructs the
quote's local identity before retry lookup and create/update serialization.
Never compare two absent local IDs as evidence that a create retry belongs
to an existing Base44 quote. The identity correction requires a Worker
deployment; the draft-edit correction ships through the signed UI update.

Each Base44 quote has one owning local quote (`local_quote_id`). The Worker
refuses an update from a different local copy (`IDENTITY_MISMATCH`) and
leaves it queued, so two quotes can never take turns overwriting the same
record. Updates from a native Base44 id keep the existing owner. Legacy
records with no owner, or owned by their own Base44 id, still accept updates.
Symptoms of a pre-guard collision: edits reverting, a quote showing another
site's data, or every version marked not current and hidden from Quotes.
Repair by restoring the original owner from its local copy, then recreating
the other quote as a new Base44 record. Always back up the data file first.

Quote owner pickers show `Real Name (email)`. The label uses the user's
`display_name`, then `full_name` / `name` when those aren't just the email or
its prefix. It falls back to the email alone when no real name is known.

### Workload: sorting and personal layout

Sorting Workload by **Open** (or any column) orders every row by that column
alone. Tile highlighting (colored left border) never pins rows to the top.
Workload columns and the sidebar tab order are saved per signed-in user on
each PC (`enquote_sidebar_order_v2::<email>`). The first person to sign in
after this update keeps the old per-PC sidebar order; others start from the
default. **Reset tab order** affects only the signed-in user.

### Workload: tagging a teammate into Tasks

The leftmost Workload columns are **View > Tag > Open**. Use **Tag** to assign a
case task to a teammate. **Age (Days)** displays completed whole
days (12.9 becomes 12) in the table and details; its checkbox filter groups by
the same whole-day values. Imported ages and sorting retain their original precision.
On dark themes, colored O&M Status pills (including customized tile colors),
Enphase Care eligibility badges, and matching-quote badges use brighter text
and tinted backgrounds. Their light-theme appearance and status mappings are unchanged.
Choose a teammate, enter a
required due date/time (in your local timezone), and optionally add a note.
**Tag and create task** sends a readable direct message and creates an open
`Review case ...` task in the recipient's private task list. Tasks shows the case
link, sender's email, note, and due date. The reminder defaults to the due time;
the recipient can edit, complete, snooze, or delete it like other personal tasks.
The sender does not receive a shared completion tracker.
Completed tasks are hidden from the Tasks calendar, including the selected-day
list and day counts. They remain available through **Show completed** in List
view. Reopening a task returns it to the calendar.
The New/Edit task form includes optional **Site ID** and **Case Number** fields.
Open **New task** using the clipboard icon directly below the notification bell
from any page where your account has Tasks access. This replaces the Tasks page's
header button; the calendar's add-task controls remain available. The shortcut is
hidden in read-only viewing mode.
The shortcut opens a compact, non-blocking panel in the top-right corner that
slides in from the right. You can
keep reading and navigating EnQuote without closing the task draft. Close or
Cancel discards the draft.
Choose **For me** to save a personal task, or select a teammate under **Task for**
and click **Send task**. Teammate selection requires Messages access and an
online connection. The assignment creates a task in the recipient's private
Tasks list after sync and posts a confirmation in your direct conversation;
it does not create a copy in the sender's list or expose the recipient's tasks.
Task type, reminder, quote link, site/case identifiers, contact details, and notes
are delivered with the assignment. Failed sends keep the form open; after a send
attempt, use **Retry assignment** with the same request ID to avoid duplicates.
Deploy the updated sync Worker before using panel assignments. No task schema
migration is required.
Identifiers are saved as text (including leading zeros), sync with the private
task, and appear as site/case links on task rows. Changing the case number clears
any previous exact Salesforce case ID so the link cannot open the wrong case.

### Tasks: quotes needing attention

The Tasks screen has a separate **Quotes needing attention** tab beside **List**
and **Calendar**. Click
**Choose statuses** (or **Statuses**) to pick quote statuses and either
**My quotes** (owner, or creator when no owner) or **All quotes**. Settings are
saved per signed-in user (`enquote_tasks_quote_attention_v1::<email>`); nothing
shows until you choose at least one status. The list updates automatically: only
current quote versions appear, and a quote drops off when its status changes.
Rows link to the quote, site and case. They show days in the current status, based
on the latest matching Status History entry, or the last update if none exists.
Rows at 7+ days are highlighted. The oldest quotes are listed first. These quotes
are not tasks, so they aren't counted in the task totals or shown on the calendar.

### Text encoding (mojibake)

Source files must stay UTF-8. If you see garbled sequences in place of dashes, arrows,
`×` or `°`, UTF-8 was re-read as Windows-1252, usually after an editor or
PowerShell rewrite. `tests/noMojibake.test.mjs` fails if this appears in
`src`, `electron`, the Worker source, or this manual. On 2026-10-07, 38 local quotes with
historical mojibake (item names, scopes, notes, hold and status reasons) were repaired
and queued to sync. The backup is `Backups\enquote-data-v1.json.pre-mojibake-repair-*`.
Activity-log history was left unchanged.

Tasks are independent of the imported Workload report, so replacing that report
does not erase assignments. Delivery requires an online send; the recipient sees
the task after their app syncs. Existing Windows message notifications still open
Messages. If sending fails, **Retry tag** reuses the request ID and locks the
original fields to avoid duplicate tasks. Do not start a new tag to retry an
uncertain send.

**Rollout without an installer:** deploy the Worker changes first, then publish
the signed UI update for the compatible installed app version. No new Electron
or preload APIs and no database migration are required: the existing chat send
bridge carries a validated version-1 `case_task` request attachment. The Worker
requires a direct conversation with an allowed recipient, creates the message
and recipient task in one transaction, and returns `caseTaskId` as confirmation.
It consumes the request attachment rather than storing it in chat, so older UIs
still receive an ordinary readable message. Unknown request types on an older
Worker fail explicitly; they must not be treated as successfully created tasks.
The regular personal-task upsert endpoint remains restricted to its caller.

### Supervisor Dashboard: Quote Dashboard tab

Open **Supervisor Dashboard > Quote Dashboard** for new quotes, status changes,
stage turnaround, current aging, and lifetime quote timelines. It sits beside **Executive Overview**;
there is no separate Manager Dashboard sidebar entry. Existing `#/ManagerDashboard`
links redirect to `#/SupervisorDashboard?tab=quote-dashboard`. Older
`?tab=manager-dashboard` links still open the renamed tab.

The tab uses Supervisor Dashboard access, including coaching-feedback editing.
The old Manager Dashboard permission no longer grants or restricts access separately.
Lifecycle reports use the same quote `status_history` and `QuoteActivity` records
shown by Quotes, not the local imported-report store. Status History controls
status transitions and stage timing; Activity Log supplies the creation/edit audit
trail, changed fields, before/after values and author. Audit edits are not counted
again as transitions. Missing/unmatched status changes in activity logs are flagged.
The full activity collection is loaded (Base44 is paginated), not just the most
recent 100 per quote. Activity-load errors block charts rather than quietly hiding
an incomplete audit trail.

The activity period defaults to Last 30 Days and
supports Today, Last 7 Days, All Available History, and Custom Range, independently
of Executive Overview. Local calendar dates are inclusive. Current versions only
are counted; on-hold and reporting-excluded quotes are included by default with
filters to omit either. Status and search filters apply to all lifecycle sections.

New quotes use the earliest recorded creation activity's `action_at`, falling
back to the quote's `created_date` only when no dated creation activity exists.
Only one creation is counted per quote; duplicate creation logs are flagged.
Status changes require two different
consecutive recorded statuses; the first recorded status establishes a baseline.
Follow-ups and repeated same-status notes do not reset stage age. Every
follow-up is audit-only, even if its timestamp is missing or invalid; bad follow-up
dates are flagged without invalidating the status-duration calculation. For example,
Invoice Paid on Aug 28, 2026 at 8:35 AM to Scheduled on Sep 10 at 11:38 AM
is 13 days, 3 hours, 3 minutes (315.05 elapsed hours), ignoring intervening follow-ups.
Completed intervals appear in status-to-status turnaround; live Scheduled age starts
at the Sep 10 transition.

Turnaround summaries use only the last two actual status visits per quote, ignoring
follow-ups and same-status notes: the previous status's entry-to-exit duration.
Each quote contributes at most one
interval to turnaround, grouped by previous/current status with average, median,
longest and quote count. Timing includes all filtered current quotes regardless
of activity period; activity counts still include recorded events within the period.
Durations are elapsed calendar time, not business hours. Current pipeline/aging
and the selected quote's lifetime history ignore the activity date range.
Quote explorer shows previous status, its preceding status, **time to previous
status**, current status and time in current status. The previous interval runs
from entry into the status before the previous status to entry into the previous
status, anchored to the latest recorded visit matching the current status.
For example, a quote currently in Invoice Paid with previous status Quote Pending
Payment measures HO Approved, Invoice Required to Quote Pending Payment, not
Quote Pending Payment to Invoice Paid. This rule applies to all filtered quotes.
With two recorded statuses, previous status can be known but its earlier interval
remains Unknown; with only one, previous status is also Unknown.
History gaps, invalid/future dates and current-status mismatches are flagged.
Current age uses the latest dated visit matching the quote's current status through
now, ignoring follow-ups and repeated same-status notes. Older gaps, creation-date
discrepancies or other status mismatches remain warnings but do not invalidate that
known current-status entry. Explorer previous-status timing uses the same usable
dated visits, ignoring older gaps, follow-ups and repeated same-status notes.
Turnaround remains conservative when history is incomplete. Current age stays Unknown only when no valid, non-future matching
status entry exists. No history is reconstructed from `updated_date`. Creation counts are
current-version records, not deduplicated version families.

The notification bell shows the recorded quote updater, not the viewing user or
an older status-history author. When attribution is unavailable, it shows
"updated (updater not recorded)" without guessing an email. Recorded
`last_updated_by` and `updated_by` fields are supported; status-history attribution
is used only when it matches the update's time. Desktop quote and product edits
require a signed-in identity and record its verified email. Older events that never
recorded the editor cannot reliably be attributed retroactively.
Existing quote notices recover the recorded editor when their quote ID and update
time still match the current record; a newer edit is never used to label an older event.
Opening the bell marks notifications read;
Clear and Clear All persist dismissals per signed-in user on this device, including
across reloads and replayed sync events. New updates remain visible. Storage errors
are reported instead of silently claiming notifications were cleared.
Updates are visible to all signed-in users, but reading or clearing them affects only
the current user's state on this device. Sync-only timestamp/metadata refreshes do
not generate quote or product update notifications; repeated copies of an event
appear once. Signed-out users do not see the notification feed.
Assigned tasks also appear in the recipient's bell as **Task assigned by ...**,
with the task title and **View Task** link. This includes assignments from Messages
and case tags. The notice arrives when the recipient's private Tasks sync receives
the assignment, without waiting for its reminder time. It is not stored in the
shared update-notification collection. Repeated syncs and task edits do not recreate
a cleared assignment notice; task reminders remain separate notifications.

Status snapshot tiles use the theme's matched card/background text colors, with
colored dots identifying each status. Primary action buttons use matched theme
colors without decorative glow shadows.

In **Messages**, copy a screenshot, click the message composer, and press **Ctrl+V**
to preview it. Remove a preview with its X button or press Send to share it, with
or without text. PNG, JPEG, WebP, and GIF images are supported, up to **5 MB each**
and **10 total attachments** per message. Switching conversations clears unsent
screenshot previews. Failed sends retain a Retry option. Images are stored separately
from message text and can only be fetched by current conversation members.
Screenshot support requires the updated desktop bridge and deployment of the Worker
chat-image endpoints; it cannot be enabled by a UI-only update.

The **chat dock** sits at the bottom-right on tabs other than Messages. New incoming messages
add minimized tabs without interrupting your work; old unread history does not
automatically open tabs at startup. Clicking a dock tab opens a small chat window
without redirecting the current page. In Messages, selecting a conversation opens
the original full-page thread; the dock and its tabs are hidden there. Returning to
another tab restores the dock without discarding its drafts. Successful
sends also open their conversation in the dock. Multiple expanded windows sit directly
side by side, with additional chats opening to the left; the row scrolls horizontally
if it exceeds the available window width. Each chat minimizes and closes independently.
Other minimized chats remain available as tabs. Minimize preserves that chat's draft, and Close
removes its tab. Use **Open in Messages** only when you want the full-page conversation.
Minimized tabs sit to the left of expanded windows, not underneath them, so the
first expanded conversation remains flush with the bottom-right corner. Hidden
chat panels are immediately removed from hit-testing without discarding drafts.
The compact window shares message history, quote/GIF/screenshot attachments, retry
controls, and chat colors with Messages. Minimized chats are not marked read.
Open tabs and drafts last for the current app session and are cleared when the signed-in
user changes. The dock respects the user's Messages page access.
The round **Message someone** button in the bottom-right is available on every
screen, even with no open chats. Click it to view recent conversations, ordered
newest first with avatars, message previews, times, and unread counts, matching
the full Messages list. Use the small **+ (New conversation)** button
to search teammates or create a group; the back arrow returns to recent chats.
Selecting a recipient opens a compact chat on other tabs, or the full conversation
when already in Messages. The recent-conversations panel and open chats align
flush with the bottom-right edge, above the bottom chat-tab/message-button strip.
The message launcher is round, matches the notification bell's size and 16px edge
spacing, and uses the theme's primary accent and matching foreground. It hides
while its menu is open and returns when the menu closes. The menu itself is flush
with the bottom-right edge. The launcher stays clickable at any scroll position.
The chat overlay stays outside the page's scrolling layers without blocking clicks
on the rest of the page; modal dialogs remain above it.
An expanded chat uses its header for minimize/close instead of a duplicate name
tab underneath. While chats are expanded, the launcher stays just above the dock
against the right edge and follows its height as chats resize. When all chats are
minimized or closed, it returns to the bottom-right; other minimized chats remain
in a slim tab strip. Opening the recent-conversations menu hides the launcher.
Opening, minimizing, and closing chats uses a short fade/slide transition.
Reduced-motion settings disable these animations.
Hover a sent or received message (or focus its actions with the keyboard) to
reveal quick reactions and the three-dot options menu. You may select multiple
different reactions; click a selected reaction again to remove your own selection.
Reaction badges show totals and participant names on hover. Pending, failed, and
admin-removed messages cannot be reacted to. Admin removal remains in the options
menu for administrators only. Reactions work in full Messages and compact chats
after the updated Worker, reaction migration, and desktop bridge are released.
Messages show the sender's saved profile picture beside the bubble, including in
direct conversations and floating chats. Received messages show the sender's name
above the bubble; your own picture appears on the right. Users without a picture
show initials. Consecutive messages from the same sender reuse the avatar gutter,
with a new picture/name after a sender change or a gap of five minutes.
Use the **Share something in EnQuote** cursor button beside chat attachments to
pick an item in the current page content. Chats temporarily hide so you can select
the page underneath. The click selects the item without activating its normal
action; Escape or Cancel exits selection. The resulting link stays in the draft
until you send it, and can be removed like another attachment.
Supervisor Dashboard metrics select the entire tile, including clicks on its
number or contributing-records button. Shared tile links carry the applied
reporting period's exact dates and KPI display mode. Opening one uses that period
without overwriting your saved preference and temporarily reveals the linked tile
even if your tile customization normally hides it.
Auto-Drafter selects whole case/quote tiles, not individual values or toolbar
controls in the tile list. Its opened quotes use the same spaced label-and-value
groups as Quote Details; shared field links reopen the saved Auto-Drafter quote.
Quote Details selects related label-and-value groups (such as Site ID,
Case Number, and Project Picklist), complete line-item rows, totals, and detail
sections. These links retain the existing five-second destination highlight and
do not grant access to records or fields the recipient cannot normally view.
Selecting the main quote background shares the quote page itself instead of
selecting all of its details as one large group.
Space between detail rows belongs to the preceding field's selection area, so
clicking between Site ID and Case Number selects Site ID rather than the whole card.
Shared quote fields and sections include the quote number in their link label
(for example, `Status History - Q-123`). Whole-quote `Quote Q-123` labels stay unchanged.
Auto-Drafter details use the draft reference, or the real quote number once sent.
The composer keeps a full-width text area with compact, borderless action icons
at the lower right. Text grows up to a scrollable six-line area; Enter sends,
Shift+Enter inserts a newline, and Ctrl+V still pastes screenshots.
Use the main **Task** button to create or assign tasks. The chat composer no
longer has a separate task button.
Message timestamps sit directly beneath their bubbles. Hover actions float above
the timestamp without leaving an empty toolbar-sized gap.
Quote Details groups the site, status, and version together, with the quote number
below. PDF downloads occupy their own row; quote actions are left-aligned below a
divider and wrap consistently on smaller screens.
Recipients open the item inside EnQuote, scroll to it, and see a theme-colored glow
for **5 seconds**. Quote cards open their specific Quote Details page.
Workload selections default to the entire case row, including when you click a
cell, badge, or action within it; the recipient's glow covers that row.
Other elements use stable IDs or unique visible labels; ambiguous labels are rejected
rather than highlighting the wrong item. If an item changed, was deleted, or is
not accessible, EnQuote reports that it could not find it. Page permissions still
apply; links do not grant new access or execute page actions. Share links require
the updated Worker attachment handling and desktop UI.
Drag the top-left corner of a chat window to resize its width and height, or focus
the resize handle and use the arrow keys. Sizes stay within the app viewport and
are retained while that chat remains open, including when minimized.
Hold Shift while dragging a chat's resize handle to apply the same width and
height to all open chats, including minimized ones. Normal dragging resizes only
that chat. The shared size clears when you switch signed-in accounts.
GIF-only messages fill the rounded bubble without themed padding or a colored
frame. Messages with a text caption or other attachment types retain their normal
chat colors and padding. Sending/failed status and reactions remain below the GIF.
Hover reaction shortcuts and the message-options menu appear at the upper-right
of the message row with larger click targets. The space between the message and
toolbar remains hoverable so the controls do not disappear while moving to an
emoji; existing reaction badges and timestamps stay below.
The hovered or keyboard-focused message gets a subtle outline to identify the
message being reacted to.
Chat reactions use original flat, colorful face icons rather than operating-system
emoji artwork. Like, Love, Laugh, Surprised, Sad, and Celebrate keep their existing
meanings and stored reaction IDs; older reactions use the same new artwork.
Use the smile button in the composer to open the combined **Emoji / GIFs**
menu in Messages or a compact chat. It opens on **All**, with one search field
for emojis and GIFs, separate result sections, and **See all** shortcuts. Search
text stays in place when switching between **All**, **Emoji**, and **GIFs**.
Both the original face icons and shared
custom emojis can be attached to messages. GIF search and GIPHY attribution
remain on the GIFs tab.
On the Emoji tab, choose **Add emoji**, upload or paste an image, and give it a
unique name (1-32 lowercase letters, numbers, underscores, or hyphens, starting
with a letter or number). PNG, JPEG, WebP, and GIF images up to **512 KB** are
supported. Small square images work best; transparent images and animated GIFs
retain their appearance. Names and images must be unique in the shared library.
Each GIPHY result in **All** or **GIFs** has a **Save as emoji** action. Select it,
enter a unique name, and save to share that animated GIF as an emoji for both
messages and reactions. EnQuote retrieves a small animated GIF rendition from
GIPHY, retaining animation and attribution. If no rendition fits the 512 KB
limit, saving reports an error instead of flattening the animation.
An added emoji is available to all signed-in EnQuote users; other open pickers
refresh the shared library within a minute or when reopened.
Use **More emoji reactions** above a message to react with the same shared
emojis. Selected custom reaction badges show the image and count; clicking a
badge toggles your own reaction without sending a message or notification.
Shared custom emojis require migration `0009_custom_emojis.sql` plus the updated
Worker and desktop bridge. This change does not deploy them automatically.
When testing a newly added desktop feature, fully close and reopen EnQuote to
load the updated Electron services. Reloading only the page cannot register new
IPC handlers. A "full restart" message in the picker means the desktop process
is still running its older messaging service.
Confirmed sent messages update every open view of that conversation immediately,
without waiting for the server's realtime notification. Reopening a minimized chat
also refreshes its message history.

Executive Overview includes customizable **Quotes Created** and **Quotes Worked**
tiles and a live **Quote exceptions** review queue instead of the unused historical
operations trends, source-coverage tables, duplicate attention totals, additional
trends and daily-metric history. The metric tiles and hourly wait chart remain.
Executive Overview metric tiles share equal-width columns and equal-height rows
across the grid (one column on small screens, two on medium screens, four on large
screens). Heights expand to fit the longest tile content without truncation.
Quote exceptions use live current-version records, independent of reporting period
and report category. On-hold and reporting-excluded quotes are omitted. Each quote
appears once: existing red, non-notification quote alerts take priority, then history
gaps, then remaining open quotes ordered by current-stage age. Red alerts are overdue
actions under the same rules as quote cards, not scheduled follow-up due dates.
Unknown ages are not ranked as oldest. Empty groups are hidden, each group initially
shows ten rows with Show more, and quote links open details. Full charts/history
remain in Quote Dashboard. Loading and errors are explicit, not empty success states.
Column headers in quote exception tables, quote contributing-record lists, NICE
call details and EODB date/total lists toggle ascending/descending sorting with a
direction indicator. Dates and durations sort by underlying values; missing values
stay last in either direction. Exception lists sort all rows before applying the
ten-row display limit. Recorded quote activity sorts by the latest event per quote.

The **Quotes Created** and **Quotes Worked** tiles are
scoped to the selected Reporting Period (inclusive local calendar dates).
Created counts each current-version quote once, using its earliest dated creation
activity when available, otherwise its quote creation date. Worked counts unique
quotes with a recorded status transition or follow-up in that period. Multiple
status changes, multiple follow-ups, or both on the same quote count only once
across the entire period. A first recorded status, same-status note, or ordinary
edit is not a status change. Both tiles include on-hold and reporting-excluded
current-version quotes. KPI Display Mode applies to these tiles and period-based
EODB, staffing and email tiles. Period Total counts each worked quote once across
the period; Daily Average averages daily unique quotes across all selected calendar
days, including zero-work days. Latest Day for quotes uses the selected period end.
Imported daily averages use available dated records; Latest Day uses each source's
latest available date and narrows its contributing records accordingly. Staffing
and email counts are averaged by reporting day, not by agent row. Rates and average
durations retain their weighted/average semantics rather than being summed.
Snapshot tiles and live exceptions do not change with KPI Display Mode.
They use EnQuote records directly, not imported daily-metric rows.
Both tiles offer **View contributing records**, showing one row per counted quote
with quote link, case/site, owner, and all qualifying dated activity in the period.
For Worked, a status change plus follow-ups on one quote still produces one row.
EODB tiles retain the imported report's authoritative totals. Their contributing
records show dated report totals plus matching **NICE Call RAW DATA** call details,
filtered by Contact Start Time (PST) and the selected period. Abandoned uses
`Abandons = 1`; Handled uses `Handled = 1` (abandoned takes precedence).
Agent-name NaN is not reliable for classification. Missing or unclassified records
are never manufactured to match a report total; coverage mismatches are displayed.
Handled daily report values are Total Call Volume minus Abandoned, not total calls.
For the locally inspected October 5, 2026 import, the abandoned report totals 23
(17 Pronto, 5 Enphase Care, 1 Propel); NICE contains 22 matching abandoned calls
and no Propel records. The report's 23 remains unchanged.

Loading
or source failures never display zero as a substitute; failures show a retry.
History/date warnings are not displayed on Executive Overview tiles; they remain
available in Quote Dashboard's Data quality view and quote timelines.
Valid recorded status changes and follow-ups predating the quote creation
date remain usable; the creation-date discrepancy is flagged rather than treating
the recorded event as invalid. Missing, invalid and future event dates remain
unusable and are not guessed. Audit entries that retain the same status are not
status changes; recognized status display labels match their stored status values.
Genuine audit changes without matching Status History remain warnings and never
fabricate status transitions. These reporting rules do not modify saved records.

The default **Charts** view shows activity over time, current pipeline,
average/median status-to-status turnaround, and current-stage aging.
Bar charts use vertical columns, fitting the available width without horizontal
scrolling. Pipeline shows every status bar at once, with small angled labels
and full names in tooltips. Turnaround uses wrapped labels and a responsive number
of categories with Previous/Next controls to access all routes.
Activity charts include zero-activity dates; periods longer than 90 days use weekly buckets,
and periods longer than 365 days use monthly buckets. Turnaround is ordered
slowest first. Every chart's hover details appear in its top-right card header,
not over the plot. Bars and lines are display-only; use the status dropdown to filter.

Use **Quote explorer**, **Audit trail**, **Timing details**, and **Data quality**
for drill-downs instead of displaying every table at once. **History** opens a
scrollable lifetime timeline with explicit source labels, author, reason, stage
duration, and expandable audit field changes. The explorer and audit trail are
paged in groups of 50. **Rejection and coaching analysis** retains the previous charts separately;
those charts do not use the new activity filters. Quote/activity/review load failures
show retry controls instead of zero-shaped report totals.

### SOP Library sections and pages

Sections are the top level of the SOP Library (the equivalent of OneNote workbooks):
**Sections > Parent pages > Subpages**. There is no separate workbook level. Every
section, including ones saved under older workbook groupings (for example
**O&M Marketplace**), appears in the Sections column with its pages unchanged.

Use **Add section** (or the folder-plus button beside **Sections**, or in the collapsed
navigation) to open the section-name dialog. Enter a name and choose **Create section**
or press Enter. The new section is selected after a successful save. Use the section's
actions menu to rename it with the same dialog. Cancel leaves sections unchanged;
save failures keep the dialog open so the name can be retried.

The second navigation column contains pages and indented subpages. Use **Add page**,
or a page's **Add sub-page** action, and **Save** in the editor. Parent-page arrows expand
and collapse their subpages. Search spans all sections and shows section names.
Page groups start collapsed when opening SOP Library and whenever switching sections.
Expand a group with its arrow; choosing a subpage within the current
section reveals its ancestors. Moving or opening a page in another section reveals
only that page's path.
To reorganize an existing page, open it, choose **Edit**, then choose its **Section**
and **Parent page**. Choose **Top-level page (no parent)** to promote a subpage.
Click **Save** to apply the move; Cancel leaves its location unchanged. Pages can be nested
under other pages, and their existing subpages move with them, including across sections. A page cannot be placed under itself or its descendants.
For a quick move, use a page's actions menu: **Move to parent page**, then choose the
destination page. The list shows page names with their section for context.
Only pages with existing subpages appear as parent destinations, both in this menu
and the editor's **Parent page** selector. Use **Add sub-page** to establish a new parent.
The current parent is disabled, and the page itself and its descendants are excluded.
The page and all its subpages move to the destination parent's section together.
For sections, **Edit section** renames the section.
Expanded navigation shows full section and page names, wrapping long names onto multiple lines.
Keep section-name entry in an in-app dialog: Electron does not support `window.prompt`.

#### Importing OneNote sections

In Windows OneNote desktop, export a single section using **File > Export > Section >
OneNote Section (.one)**. In EnQuote, choose **Import OneNote**, select the file, review
the page list and conversion notes, choose a destination section, acknowledge the
sharing/format limits and choose **Import section**. Windows OneNote desktop must be
installed and able to open the section; unlock protected sections there first.
No Microsoft app registration or direct SharePoint access is needed.

To import several sections at once, select multiple `.one` files in the file picker
(Ctrl+click or Shift+click, up to 20). All files share one destination. Under an existing
section, each OneNote section becomes its own parent page, in the order selected; with
**Create a new section**, each becomes its own EnQuote section. If any file cannot be read,
nothing is imported and the message names that file. If a save fails partway through,
finished files stay imported and **Retry import** continues from the file that failed.

By default, the selected EnQuote section is the destination. The importer creates a
parent page named after the OneNote section, then nests all imported pages beneath it,
preserving their original order and nested subpages. Existing content is not changed.
Alternatively, choose **Create a new section** in the destination-section selector
to retain the standalone-section import behavior. Destination controls lock when an
import starts, so partial retries continue in the same place. Before starting, the
destination section remains editable and lists every section, including General and
O&M Marketplace.
Each page gets editable text, rich-text fragments, lists and tables plus a PDF snapshot
rendered by OneNote. Free-form layout, images and ink remain visible in the PDF; they
are not editable OneNote objects. Embedded attachments, audio/video, tags and metadata
are not extracted, and the PDF does not preserve their underlying contents. Retain the
original `.one` export. This is a one-time copy, not ongoing OneNote synchronization.
Review converted content before replacing your original workflow.

Imports are shared SOP data and require the SOP sync service to be reachable when
saving. Existing content is never overwritten. On a partial failure, keep the dialog
open and use **Retry import** to resume without duplicating completed pages. Cancel
retains already-imported pages but removes the local temporary PDFs; a fresh import
creates a separate new section. Previews expire after 30 minutes.

Limits: one `.one` section at a time, 250 MB source file, 500 pages, 20 MB per PDF,
500 MB total PDFs, 200-character titles and 900,000-character editable content per page.
Split oversized sections/pages in OneNote first. OneNote may leave the file open in
Recent Opened Sections. This feature includes Electron main/preload changes: restart
desktop development after changing it, and ship a full desktop update rather than
only a UI update.

Validation: `node --test tests\electron\oneNoteImport.test.cjs`,
`powershell -NoProfile -File tests\electron\oneNoteExport.test.ps1` and (Windows
OneNote desktop installed) `powershell -NoProfile -STA -File tests\electron\oneNoteNative.test.ps1`.
The native test creates and closes only its own temporary synthetic notebook.

---

### Super Admin-only user access preview

In **Developer Console** (Shift + backtick), a verified Super Admin can select
**View user access**, choose a service account, and filter its page-access table.
Each row shows Allowed/Denied and the exact matching rule: hidden-page override,
explicit allow, admin role, shared viewing page, configured/default role grant,
or no grant. The preview uses the same decision helper as actual page navigation.
Hidden-page overrides still win over admin and explicit allow.
Use the Developer Console's refresh icon to reload the service account list and
viewing-mode readiness. Exit viewing mode from the banner in the separate viewing
window; the console itself does not change your signed-in account.

Select **Start read-only viewing mode** to open the normal EnQuote renderer in a
separate isolated desktop window, with a persistent **Viewing as - read only**
banner, user selector and **Exit viewing mode** button. The normal sidebar, page
components, widgets and role-based filters use the selected account's live service
permissions. Explicit page denials on your own account still restrict the preview.
Messages, Tasks and Base44_DTO are intentionally omitted, including direct routes.

This is **not impersonation or sign-in as another person**. Your real identity
stays unchanged and a read-only banner identifies it. No target account token,
password, sign-in session or browser cookies are obtained. Electron rejects
private-data calls and mutations from this window, including direct bridge calls
from developer tools. Only an explicit allowlist of shared reads is permitted;
new IPC channels are blocked by default. Interactive controls remain part of the
normal pages, but attempted writes are rejected rather than saved. Account setup,
automatic imports and Care-table migration are not started by the preview.
ChatDock, private unread/task hooks, notifications and update/normal Developer Console
overlays are not mounted in the viewing window. Your main window stays signed in
as you, with your own Messages unchanged.
The viewing banner has its own **Debugging Console**, also available with Shift +
backtick. It runs allowlisted diagnostics for the viewed account's service permissions
and the shared data available on your computer, not the user's remote device or code.
`errors` reads only this viewing window's bounded in-memory error log; those entries
are never read from or written to the main account's error collection or shared reports.
`refresh-view` refetches this window's queries. `recheck-permissions` checks live actor
and target policy; changes reload the view, and lost authorization closes it.
`check-ui`, `check-updates`, `updates` and `refresh-supervisor` are blocked here.
Clearing diagnostic output affects only this console's transcript.
Existing operations already started as your own account are not cancelled by preview.
It does not reproduce
another Mac's filesystem, cached UI or local account state. Use the affected user's
Debugging Console to compare their local session against this service-side result.
**Exit viewing mode** closes the viewing window and focuses your unchanged main
window. The viewing window uses an in-memory browser partition, without the main
window's local storage, cookies or query cache. Selecting another user clears its
storage and reloads its renderer. Only local application assets can be requested
by that renderer; arbitrary network requests and new windows are blocked.
Local-only preferences, imports, private settings, employee home addresses and
unsupported data reads are unavailable, not copied from either person's machine.
Shared data is the data available on the troubleshooting computer, so this is not
an exact remote desktop or a reproduction of another Mac's cache/theme/files.

Only a live `admin.policy` response for the signed-in email with `super_admin` as
primary or additional role enables the UI. Ordinary admins do not get the tab;
cached/offline, loading, failed, missing or wrong-account policy cannot enable it.
The panel independently checks this gate and reads a fresh existing admin overview.
Electron independently checks the real verified account's live Super Admin policy
before opening a window. It refreshes actor authorization, target account and role
matrix at least every 30 seconds and reloads the view when target permissions change.
It closes the window on account changes, unavailable live authorization or revoked
Super Admin access. The existing admin overview still permits ordinary admins to
read account metadata, but it cannot grant them a viewing window.
Server chat endpoints continue to require signed caller identity and active
conversation membership. Super Admin status does not grant conversation access;
there is no impersonation endpoint. This protects application access, not against
someone who independently controls the server/database.

Normal-page viewing mode requires a **new desktop installer** on Windows/macOS.
A UI-only update on an older installer can show the access table, but explicitly
disables the Start button. It is not included in the previously published beta.
This feature adds no Worker endpoint and requires no Worker deployment; existing
membership enforcement remains in place. Do not publish these native changes with
the 1.3.0 UI-only hotfix snapshot.
Use a new desktop version number for the installer so an older 1.3.0 downloaded UI
cannot replace its matching renderer. A renderer without viewing-mode support fails
startup explicitly instead of reporting that a viewing session opened successfully.
The Start button checks the running main process's native readiness, not just the
preload method's presence. If you see `No handler registered for 'viewing:start'`,
save your work and fully quit EnQuote (on macOS, use **EnQuote > Quit EnQuote** or
Command+Q), then reopen the updated desktop app. Reloading the renderer or Vite hot
reload does not load new Electron main-process handlers. For a source checkout,
stop the old desktop run and relaunch with `npm run desktop:dev`. An installed
older desktop build requires the new installer, not a UI-only update.

Developer validation: after `npm run build`, run
`node scripts\test-readonly-preview.cjs` for the isolated Electron acceptance checks.
Run `node --test tests\electron\readonlyPreview.test.cjs` for the native default-deny,
privacy, live authorization, renderer compatibility and closing-window regressions.

### Debugging Console and macOS troubleshooting

Open **Developer Console** with **Shift + backtick** (the physical Backquote key),
then select **Debugging Console**. It is available to signed-in users even when a
page denies access. It never changes roles or bypasses page authorization.
Commands are fixed names, not arbitrary JavaScript, Terminal, or shell commands.
The console expands to 1400 pixels when space allows. Its tabs stay on one row;
on smaller windows, scroll the tab strip horizontally. Refresh/clear controls
remain visible outside the scrolling strip.

| Command | Purpose |
| --- | --- |
| `help` | Command descriptions and action labels |
| `diagnose` | All read-only checks, retaining individual failures |
| `runtime` | Actual installed version, process architecture, translated execution, Mac install location, data-folder access, credential presence |
| `updates` | Installer state/last error and signed UI version; no network check |
| `permissions` | Session, local synced account, and service account access to Supervisor Dashboard; identifies offline cached policy |
| `supervisor` | Local metric counts/date coverage, report row counts, last reconciliation outcome, separate Care table health |
| `errors` | Last 20 recorded app errors, without stack traces |
| `check-updates` | Check installer feed; the existing updater may download an available installer |
| `check-ui` | Check/download a signed compatible UI bundle, without applying/reloading |
| `refresh-supervisor` | Reconcile shared Supervisor collections, then refetch active queries |
| `refresh-view` | Refetch active queries without deleting cache/data |

Read-only buttons run immediately; actions must be entered and run explicitly.
There is no restart, uninstall, data deletion, arbitrary code execution, or automatic
UI application command. Output is bounded to 20 entries and stays in memory while
the dialog is open. **Copy transcript** copies locally, not to a server. Common
credential patterns, emails, and user-home names are redacted; report rows and full
user records are not included. Review output before sharing; free-text errors may
contain additional identifying information.

For an affected Mac, run `diagnose`, then `check-updates` and `updates`.
Keep installer version separate from the downloaded UI version and `runtime.ui.loadedUiVersion`:
a downloaded UI may be staged but not yet loaded. Signed UI updates require an
**exact installed desktop version match** and cannot upgrade Electron/main/preload.
Missing bridges explicitly require a **full desktop update**; older builds can
still run commands backed by their existing bridges through a compatible UI hotfix.

macOS release review found the global Windows-style artifact name collided between
Intel (`x64`) and Apple Silicon (`arm64`) builds. Mac artifacts now include platform
and architecture, with both DMG and ZIP targets retained. Publish both architectures
and `latest-mac.yml` to the same released GitHub version (not just Actions artifacts);
the updater needs ZIP assets and matching metadata. The workflow has explicit release
write permission and includes metadata/blockmaps in its backup artifact.
The workflow remains **unsigned**. Reliable Mac installer auto-update requires
proper Apple code signing of the installed and replacement apps; signing/notarization
must be configured separately before promising automatic upgrades. Do not disable
signature validation or recommend globally bypassing Gatekeeper.

If updating an older unsigned Mac fails, use the appropriate architecture's DMG for
a manual upgrade: back up EnQuote's data folder, quit EnQuote completely (closing
the window is not quitting on macOS), replace EnQuote in Applications, eject the
DMG, and launch the Applications copy. Preserve the existing data folder/app identity.
`runtime` flags mounted DMGs, App Translocation and non-Applications locations.
Validate on real Intel and Apple Silicon Macs; Windows unit/build checks cannot
verify Gatekeeper, Apple signing, or Squirrel.Mac installation.

For Heather, run `permissions` and `supervisor` on **her signed-in machine**.
Approvers do **not** have default Supervisor Dashboard access; this is intentional
and unchanged. An administrator can grant that page explicitly. Explicit deny
wins over allow; cached offline policy or a stale local role can disagree with the
current service account. Distinguish Access Denied from a daily-metrics read failure
(now shown with Retry), missing imports, and an empty selected reporting period.
Separate large Care table files are local-only: Supervisor reconciliation reads the
main collections, and records over the Worker's size cap also remain local-only.
Diagnostics expose those limits; a successful sync is not proof that every local
report table is shared. Partial record failures now appear in reconciliation results
instead of being reported as complete success.

This change needs a **new full desktop release** for native diagnostics and installer
checks. Do not reuse an already-published version number. No release is published
by editing this code; build/publish and real-device upgrade testing are still required.

#### UI-only hotfix for installed 1.3.0

The Debugging Console, permissions/local-data/error checks, dashboard daily-metrics
error display, and clearer Admin Menu labels can ship as a **signed UI-only hotfix**.
They use the existing 1.3.0 preload. `runtime` reports the installed version from
`ui.getInfo` and exact bridge capabilities; unavailable native fields are explicitly
listed, never inferred from the renderer's package version or browser user agent.
`check-ui` and `refresh-view` work without a newer preload.
`check-updates` and `refresh-supervisor` are labeled unavailable until their native
methods exist. An available-command label does not mean that a network operation succeeded:
its actual result is displayed after running it.

Do not publish from the full desktop working tree: `publish-ui.cjs` correctly rejects
Electron/package changes. Prepare a separate **local release-compatible source
snapshot**, based on tag `v1.3.0`, with the approved current UI overlaid (including
pending UI changes when explicitly approved, so existing UI fixes are not rolled back).
Keep package/dependency manifests, Electron and signing public key identical to
the release. Run tests/build/smoke in that snapshot, then use its unchanged UI
publisher, first with `--channel beta`, before promoting to stable.
The snapshot requires the publisher's normal local credentials/signing key and
Worker tooling; never commit those files or disable the main-process safety check.
Preparing/building a snapshot does not publish it. Native fixes remain in the main
working tree for a later full desktop release.

Andrew's functioning Mac is a useful comparison, not proof that Heather's running
copy has the same native code or downloaded UI. Run `diagnose` on both devices.
This hotfix cannot reach a machine whose existing signed UI updater cannot download
or apply it; that machine still needs a manual compatible installer upgrade.

**Admin Menu > Live sessions:** App/UI/Resolved role are client heartbeat telemetry;
Effective role is the server's independently resolved account role. Missing App or
Resolved role is now labeled **Not reported**, not `?` or an assumed old version.
An empty UI version means **Bundled or not reported**, not necessarily a failed UI
update. `runtime.presenceTelemetry` shows the versions/role that this desktop sends
and the last heartbeat outcome. Heartbeats and error reports now identify the
**loaded** signed UI, not a downloaded update awaiting reload. A version label alone
does not prove two installers were built from the same code, especially if a version
was rebuilt or platform releases were produced from different commits. Compare
native bridge availability and runtime telemetry; ship a higher desktop version for
native corrections rather than rebuilding 1.3.0 in place.

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
