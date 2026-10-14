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

### Auto-Drafter: Imported cases

Auto-Drafter no longer has intake filters. Every case in the imported report is
listed, including closed cases, cases in any O&M Status, cases without a
recognized request comment, and cases that already have a real quote. Comment
rows still collapse to one tile per case; search and the case-category filter
only change what is displayed. Automatic drafting still skips cases that already
have a real quote and comments without usable structured scope.
Recognized headings are matched fuzzily at the start of a comment line:
**O&M_QUOTE**, **O&M_QUOTE_REQUEST** and typed variants such as
`O&M Quote Request`, `O & M QUOTE`, `OM-QUOTE`, `O&M_QUOTE_REQ`,
`**O&M_QUOTE_REQUEST**` or `[O&M_QUOTE]`, plus **Quote Request(s)**, including
dated author prefixes such as `10/9 - PS:`. A mention later in a sentence (for
example "asked about the O&M quote") is not a heading.
Structured scope/quote fields can also identify a request without the marker.
For each case, an actual request is preferred over a later ordinary note, then
the newest request revision. Case keys are normalized before deduplication.

**Export Excel (n)** (Quote Requests view) downloads exactly the cases currently
shown, so the case category and search filters apply. The file is named
`auto-drafter-<category|all>-<date>.xlsx`. The *Quote Requests* sheet has a
frozen teal header row with filter drop-downs on every column, banded rows,
columns sized to their contents (long text columns are capped) and no text
wrapping. Each row has: Case Number, Site ID, O&M Status, comment created date,
requester, case category, panel request (Yes/No), draft status (Not drafted,
Draft ready, Sent to Quotes), quote number, line-item count, draft total, draft
generated time, whether a quote already exists in EnQuote, Golden Quote (sent
drafts only), Care status, Panel RMA status, hygiene flag count and findings,
review notes, why automatic drafting skipped the case, and the full request
comment. Status cells are color-coded: draft status (green sent, amber ready,
grey not drafted), Golden Quote (gold), Care (green active, red no active Care,
amber unverified) and hygiene flags (green 0, amber 1–2, red 3+). Every case
stays on one row: multi-line comments are joined with ` | `. Case and Site IDs
stay text (leading zeros kept) and link to Salesforce and Enlighten; dates,
counts and totals are real Excel values, so they sort and filter correctly.
The export reads the saved drafts at the moment you click it (the button shows
*Loading drafts…* until they are available), so draft status, quote number,
totals and Golden Quote are never blank because the page was still loading.

### Panel request badges and Data Hygiene

Auto-Drafter automatically classifies the retained comment on every request.
The **Case category** filter separates exactly seven mutually exclusive groups:
**Panel RMA**, **Panel RMA + On-Demand**, **Enphase RMA**,
**Enphase RMA + On-Demand**, **LPUP/TPUP**, **On-Demand only**, and
**Unclassified** (no recognizable request). Every case appears in exactly one.
Mixed categories mean an RMA request plus separately quoted work; they do not
approve billing or coverage. Uncertainty no longer creates a separate group:
an unconfirmed panel RMA, panel plus other-device RMAs, or a device RMA from an
unestablished manufacturer is placed in its closest category with an amber
**review note** on the tile.
Classification updates on each new import;
there is no manual classification button or override. Electrical/service panels
are not treated as PV panels. Classification uses the **requested scope, panel
parts and Warranty Replacements**, not incidental panel mentions in findings,
installed equipment or technician access instructions. Panel leads, clips and
cabling, or removing/reinstalling existing panels to reach wiring, do not by
themselves constitute a panel request.
**Panel RMA + On-Demand** requires a panel RMA signal plus separate quoted work;
uncertain panel replacements carry a review note. A warranty
panel can be listed only under Warranty Replacements and need not be a priced
line item. Panel-RMA handling labor alone is not separate paid scope.
These are text-based suggestions, not definitive claim eligibility decisions.
They do not block drafting or submit an RMA.
The **View** dropdown switches between **Quote Requests**, **Golden Quotes**,
**Panel RMA Requests** and **Alternate Requests**, with counts. Within Quote Requests, case categories are
ordered from largest to smallest count (before search); All request types
remains at the top.

**Alternate Requests** holds comments headed **O&M_CARE_CANCELLATION**,
**O&M_ESCALATION** or **O&M_RETURN** (typed variants such as `O & M Escalation`,
`OM-CARE-CANCELATION` or a leading date are recognized). These are not quote
requests: they never appear as quote tiles, are never auto-drafted and are not
counted in Data Hygiene. Filter by **Care Cancellation**, **Escalation** or
**Return**, and expand **Show comment** to read the request. A case that also has
a real quote request stays in Quote Requests and appears in both views.

### Ranges in quote requests

Every quote input follows one range rule: labor hours, travel time, mileage,
FST count and item quantities. A range (`16-24`, `16–24`, `16 to 24`,
`between 16 and 24`) resolves to its **upper bound**. Several numbers
(`1 technician if…; 2 technicians if…`) resolve to the **largest**. Travel
written only in minutes is converted to hours (`30-45 minutes` = 0.75 h). Model
numbers such as IQ8A are ignored. Each resolved range is listed under the
draft's assumptions ("Ranges resolved: …").
If a saved draft's FST count, labor hours, travel hours or miles exceed what
the request allows (for example a draft that read `16-24` as 1624 hours), the
opened draft shows an amber warning. **Apply request values** saves the
corrected values in one click.
Unsent drafts that no reviewer has edited are corrected automatically when the
Auto-Drafter opens, and the change is listed in the draft's warnings. The same
pass lowers "Not in Catalog" lines that took a microinverter or rental price
from their notes (for example rail bolts "for microinverter mounting") to the
average price for their own category. Unmatched items are categorized by their
name first; notes are only used when the name gives no clue.

Open **Supervisor Dashboard > Data Hygiene** for the full intake review subtab.
The Executive Overview hygiene tile links there. The tab provides request-case,
flagged-case, author and flagged-rate summaries, top-10 author and issue-category
bar charts, an author filter, and searchable source-comment details. You can
import or refresh the shared Quote Request Cases report directly there.
Auto-Drafter also offers a **Data Hygiene** review shortcut and intake-review
badges. This review uses the latest report independently of existing quotes or the Executive Overview date range.
Tiles show just the category and flag count by default. Expand **Details** to
read classification evidence, routing reasons, the comment author and specific
intake/source issues; expansion does not open the quote. Long issue lists can
also be expanded rather than relying on hover text. Opened drafts group request
type, routing reasons and source/intake checks
in **Request review**, directly below the quote header and Care banner. Panel RMA
and Data Hygiene actions stay inside that group; Edit/Send remain in the header.
Routing badges stay visible in that group; expand **Why these routing flags?**
for full explanations. Longer intake/source lists expand in place. Repeated
Site ID/Case Number mismatch warnings are counted once, and those mismatches are
shown before less critical template issues.
**PV Module rule:** any quoted line item containing `PV Module` (case-insensitive,
including longer names such as Compatible Replacement PV Module) routes to
**Panel RMA**, even when RMA Required is unknown or says No. If other non-PV-Module
quoted items also exist, including materials or services, it routes to
**Panel RMA + On-Demand**. This rule checks imported items and saved/edited draft
items; it is a workflow-routing rule, not confirmation of manufacturer eligibility
or warranty coverage. Incidental PV Module mentions outside line items do not
trigger this rule.
When a saved quote has line items, those determine whether additional quoted
items exist; removing an extra item is reflected in its category. An imported
PV Module request still retains panel routing if the RMA panel is not priced
in the saved quote. Changed source comments are explicitly flagged; saved quote
contents are not automatically regenerated.

Checks compare the comment to the supported Quote Request Agent output structure:
the standardized header/sections, core site/case/customer/address/issue/scope
fields, matching site/case IDs, quantities for listed items, and current O&M
Status. Recognized later quote-workflow stages are observations, not automatic
intake violations. An issue-category chart counts each case once per category;
categories can overlap. One request per case is retained, preferring structured
requests over later ordinary notes, then the newest request revision.

Names come from **Case Comment Created By**, never Case Owner. Unknown authors
remain explicit. The author may not be the requesting FST: verify attribution
before coaching or escalation. Flags identify evidence to review, not misconduct
or proof the agent was not used. Photos, actual agent usage, factual accuracy and
measurements require verification in Salesforce. A structurally complete request
means **no detectable intake issues**, not fully verified SOP compliance.
No historical compliance record or automatic personnel escalation is created.

### Find in Catalog, added products and Enphase data sheets

**Find in Catalog** (the search icon while editing a draft, or **Swap** on a source
line) searches the price list by name or SKU. It has two extra parts:

- **Enphase reference (not in price list)**: Enphase products from the built-in
  knowledge base (`src/features/quoteDraftAgent/enphaseKnowledgeBase.js`) that
  match the search but have no price. Each result shows the key specs and links
  to the official enphase.com data sheet it came from.
- **Add product**: use **Add** on a reference, or **Can't find it? Add "…"**, then
  enter a name, optional SKU, unit price, category and unit. **Add and use**
  saves the product, puts it on the current line, and (with "Remember this swap")
  teaches the learn feature. Every later draft can match and price it.

Products added this way show an **Added by reviewer** badge and can be removed
with the trash icon. They are stored in the local `autoDrafterCustomProducts`
collection; built-in catalog names always win over an added product with the same
name. An app that was running before this update must be fully restarted before
it accepts the new collection. Until then, added products are kept in browser
storage and moved into the collection automatically after the restart.

The knowledge base covers IQ8 / IQ8X / IQ7 / IQ7+ / IQ7A microinverters, IQ Cable
and accessories, and the IQ Gateway. Each entry cites a data sheet revision in
`ENPHASE_SOURCES`; when Enphase publishes a new revision, update the entry and its
source together. Line items that match a reference show a one-line spec summary
with a **Data sheet** link. The **Compatibility & Dependency Flags** card adds
sourced notes (blue) for:

- microinverter quantities above the data sheet's maximum per 20 A branch circuit;
- IQ8 joining an IQ7 site (allowed only for the documented configurations) and IQ7
  added to an IQ8 site (not supported);
- Enphase products on the draft that are not in the price list.

These notes are informational and never change prices or quantities.

The **+** button next to the search box opens the Add product form directly,
pre-filled with whatever was typed. **Add Item** on a draft (and in the Quote
Draft Agent preview) no longer adds a blank free-text line: it opens the same
picker titled *Add Item from Catalog*, and the chosen or newly added product
becomes the new line with its catalog price, unit and tax code.

### Quote Draft Agent: same review as the Auto-Drafter

The Quote Draft Agent (Step 2 on the quote form) uses the Auto-Drafter's parser
(`parseQuoteRequestCase`), so ranges and pricing are identical. Its preview also
shows the Auto-Drafter's request type, routing flags (LPUP/TPUP, RMA, Gateway
warranty, Care/Inside Sales) and parse warnings, the data sheet line under
Enphase items, and the shared **Compatibility & Enphase data sheet checks**
(`src/components/autoDrafter/DraftReviewFlags.jsx`, also used by the draft page).
Alternate requests (Care Cancellation/Escalation/Return) and multiple quote
options are held for review with **Draft Anyway**. Each item has **Find in
Catalog** (with Remember this swap) and a remove button, and **Add Item** adds
from the catalog, so the preview can be corrected before **Apply to Quote**.

On Quote Details the status dropdown is now first in the action bar, followed by
**Submit / edit Panel RMA**.

### Automatic drafts and warranty-service routing

Eligible imported requests automatically generate saved **review drafts** while
Auto-Drafter is open. Drafts are generated sequentially, not all at once. Existing
saved/edited drafts are never overwritten; real Quotes are never created or sent
automatically. Search and request-type selections only change what is displayed.
Cases that already have a real quote are never drafted automatically.
Requests without a case number or a usable structured scope/line items remain
visible with an explicit preparation message instead of an empty generated quote.
Generation errors identify the case and provide **Retry automatic drafts**.
Clearing generated drafts pauses automatic generation on that page until the
next import or **Resume automatic drafting**; clearing report data does not
remove real quotes. Local atomic guards prevent duplicate case drafts.
Labor ranges are preserved: `3-4` hours uses the existing worst-case estimate of
4 hours, not 34. Multiple explicit quote options remain visible for review and
are not automatically combined into a priced draft. Older saved drafts remain
unchanged, with warnings when labor exceeds the source range or alternatives may
have been combined; review and edit them before sending.

Descriptive $0 service lines (for example "Microinverter Replacement", "ATS
Replacement", "Array Removal and Reinstallation") are no longer added as line
items; the service type and the assumptions note describe the work. Older unsent
drafts are cleaned when loaded; sent quotes are unchanged.

Collapsed quote tiles share one size; a tile grows only when its Details dropdown
is expanded.

**View in O&M request**: line items that are Not in Catalog or not high
confidence show the original request text they came from, highlighted in the
comment. **Swap item** replaces the item with a catalog product. With
**Remember this swap** checked (default), future drafts use that catalog item
whenever a request uses the exact same wording (case and spacing ignored). These
items show a **Learned swap** badge; **Forget** removes the rule. Learned swaps
are saved in this computer's EnQuote data. A swap marks the draft as edited, so
it can no longer qualify as a Golden Quote.

Routing badges are automatic advisories, not automatic submissions or messages:
- **LPUP/TPUP**: microinverter purchases/upgrades, including recognized IQ/M models
  and explicit competitor-to-Enphase purchases.
- **Microinverter RMA review**: warranty/RMA or possible failed-device replacement
  scope, not a confirmed purchase. Such requests do not get LPUP/TPUP merely
  because they mention microinverters. Verify manufacturer and warranty first.
- **Enphase warranty replacement**: replacement-only Enphase device scope,
  without additional non-device materials or upgrade work. Collect serials and
  verify device dates under the team's 20-25 year serial-device review rule.
- **Gateway/Envoy: check warranty**: always check these separately; do not apply
  the 20-25 year assumption.
- **Enphase Care**: the site's latest real imported subscription is ACTIVE.
- **Inside Sales: Care upsell**: its recorded subscription is not active.
- **Verify Care / Inside Sales review**: subscription data is missing or cannot
  be verified. Confirm absence before referring for an upsell.

Care routing uses the existing subscription eligibility rules (newest real
record; excludes test/internal records). An active subscription does not prove
the device warranty or approve a replacement. Routing is based on the imported
snapshot; no request is automatically sent to Inside Sales.
The opened Auto-Drafter quote reuses the Quotes Care banner and the already
verified Site ID lookup. Missing records do not mean inactive coverage; lookup
errors are explicit and offer retry. No labor/travel fees are automatically waived.
Data Hygiene charts display case counts at the end of every bar. Issue labels
state the specific missing/incorrect information, with per-case evidence below.
The Executive Overview also shows **Most Common Data Hygiene Flags**: the top 10
intake flags in the latest imported request report, with flagged-case counts and
their share of all request cases (a case can have several flags). It does not
follow the dashboard date range.

### Supervisor Dashboard: reporting insights

- **Quote Backlog tile with no saved snapshot.** Backlog snapshots are saved every
  minute by the sync service, with history starting 10/13/2026. If the selected
  date has no snapshot (for example any day before 10/13/2026), the tile shows
  today's live backlog with an amber note naming the missing date, and the
  records dialog opens the same live list.
- **Export Excel (Data Hygiene).** On the Data Hygiene review, *Export Excel (n)*
  downloads exactly the request cases currently shown: the selected comment
  author plus the search and *Flagged only* filters. The file is named
  `data-hygiene-<author>-<date>.xlsx` and has three sheets:
  - **Data Hygiene:** a title and filter summary, a frozen header with filter
    buttons, banded rows, and wrapped bullet lists of findings and notes. Flag
    counts are color coded (green none, amber 1–2, red 3+). Case # opens the case
    in Salesforce (or a Salesforce search when the Case ID is unknown), and Site ID
    opens the Enlighten site. IDs stay as text so leading zeros are kept, and
    comment dates are real Excel dates. The last column is a one-line preview of
    the source comment.
  - **Summary:** case counts by flag type, most common first.
  - **Source Comments:** the full original comment for each case.
- **Data freshness on tiles.** Every Executive Overview tile has a caption saying
  where its number comes from and how current it is: *Live from EnQuote* (blue
  dot), *Imported/Auto-imported <time> · <report>* (green), or *<source> through
  <date>* for manually entered daily data. A tile turns amber and reads **Stale**
  when its source is older than the prior business day (weekends skipped). For
  tiles fed by several reports, the oldest import counts. "Not imported" means the
  report has never been loaded.
- **Quote Backlog Flow** (Executive Overview). For the 14 days ending on the
  selected period's end date: new quotes that entered the backlog, quotes that
  left it (completed, moved past the backlog statuses or deleted), and the closing
  and overdue counts. Each day is compared with the previous day that has a
  stored snapshot, so missed days roll into the next captured day. Hover a day to
  see the quote numbers that came in and went out.
- **Auto-Drafter Accuracy** (Executive Overview). Across all saved drafts on this
  computer: the share of drafts sent to Quotes without edits, how many line items
  matched the catalog confidently, need review or were not in the catalog, the
  requested wording that most often fails to match, and recently learned swaps.
- **Panel RMA Cycle Time** (Executive Overview). By manufacturer: open/closed
  counts, average days to close, average age of open RMAs, days from creation to
  *RMA Submitted*, and days from submission to a manufacturer decision. Also
  lists the oldest open RMAs and the average days spent in each status. Older
  RMAs without status history are timed from their creation date.
- **Flags by person** (Data Hygiene tab). A heatmap of each requester's flagged
  cases by flag type; darker cells mean more cases. Click a name to filter the tab
  to that person.
- **Hygiene trend** (Data Hygiene tab). The flagged-case rate and the four most
  common flags per day. One point is saved per day from that day's latest
  imported report. History starts with this version, so the line appears once
  reports from two different days have been imported.
- **Daily Snapshot summary.** The drafted Executive Summary adds up to four extra
  bullets: that day's Quote Backlog flow, that day's hygiene results, Auto-Drafter
  accuracy and open Panel RMAs (oldest first). Use *Regenerate* to pick up data
  that loaded after you opened the snapshot; edited text is never overwritten.
- **Daily Snapshot report (Copy/Download Markdown, Export PDF).** Pick the report
  day with the date picker in the report header (◀/▶ step one day, *Latest*
  jumps to the most recent recorded day; future dates are blocked). The picked
  day is shared with the other Supervisor tabs, and each day keeps its own edited
  Executive Summary. The report body
  is built from the same reports as the Executive Overview, for the selected day:
  - **Quotes** (live EnQuote): created, worked, Quote Backlog with overdue count,
    invoices paid and paid total.
  - **Quote Requests:** *Quote Requested* count from SFDC-Quotes, plus request
    cases reviewed, flagged rate and top three flags from Data Hygiene.
  - **Case Work** (Salesforce Case History): worked, closed, transferred out and
    events.
  - **Calls** (Incorta EODB): total, handled, abandoned, abandonment rate, average
    wait and talk time.
  - **Team Staffing** (Boise O&M Staffing Report): headcount, utilization,
    contacts, talk/ACW time, refusals, held-party abandons and transfers.
  - **Email** (Incorta O&M Email Report): emails, handle time, open backlog by age
    and oldest open case.

  The Executive Summary comes first. Each section names its source and how fresh
  it is. Sections only appear when their report is imported; a closing *Data
  Notes* list names stale and not-imported reports, and the *Report Sources* card
  shows the same information on screen. Values a report doesn't cover read
  "N/A"; nothing is estimated.

### Golden Quotes

Improper Quote Requests (marking, undo, the review list and the Executive
Overview tile) has been removed. Previously recorded marks remain in shared
storage but are ignored and no longer block drafting.

A **Golden Quote** is an Auto-Drafter quote created by following the SOP
perfectly. It must meet all of the following:
- The source request had **zero Data Hygiene flags** when the draft was sent.
- The draft was sent to Quotes **without edits** (no Save Changes before Send,
  and no later quote versions or content changes).
- The quote was **approved** (or reached a later stage) and was **never
  rejected** internally. Homeowner rejection does not disqualify it.
- The category is **On-Demand only**, **Panel RMA + On-Demand** or
  **Enphase RMA + On-Demand**. Pure Panel RMA, pure Enphase RMA (microinverter
  or IQ Gateway/Envoy replacements under Enphase Care), LPUP/TPUP and
  Unclassified are excluded.

Golden Quotes are shown as gold, shiny tiles in Auto-Drafter (**View > Golden
Quotes**) and on the Quotes page, where **Golden Quotes** toggles a filter.
Quotes sent before this feature have their SOP check captured from the current
imported report the next time Auto-Drafter opens; if the case is not in that
report, it cannot become Golden. Older sends are assumed unedited before send.
Photos and actual agent usage cannot be verified, so Golden status reflects the
report-based checks only.

### Panel RMA intake and shared tracker

Panel RMA requests are a separate workflow. Use
**Submit Panel RMA** on Auto-Drafter case/draft tiles, or **Submit / edit Panel RMA** on editable Quote Details. The form opens
before saving and prefills the case, site, owner and available notes. Saving
creates a tracker entry only, not a submission to the manufacturer or a change
to Salesforce. Wiring/catalog-material quotes remain available.

The **PV Panel RMA Tracker** supports panel model, quantity, serial numbers and
manufacturer RMA number, plus existing owner, status/history, URL and notes.
Quote Details intake also links the originating quote in the tracker. A case
with an existing entry opens that entry instead of creating another. Duplicate
case IDs and stale edits detected locally show errors; reopen the entry to
review the latest data before saving.

RMA records and manufacturer choices use the existing team collection sync,
including existing local entries; no manual migration or deletion is required.
Saves confirm local persistence, and are shared after desktop sync. Offline
edits retry when connectivity returns. As with the existing shared collections,
concurrent cross-device edits are timestamp-based last-write-wins, not a locking
workflow. Sync before editing shared cases and avoid simultaneous edits.
Concurrent offline creations can produce duplicate case entries; the intake
dialog reports those explicitly rather than choosing or overwriting one.
Browser development remains local-only. This expansion needs the updated
desktop and Worker deployed together; the old Worker does not accept these
collections.

### SOP-guided Panel RMA preparation

The Panel RMA form is a four-step wizard: **Manufacturer & case**, **Panel details**,
**Forms & evidence**, and **Review & save**. Choose an existing manufacturer or add
a new one at step 1. Step 3 finds HTTPS links in that manufacturer's SOP pages or
matching rows in the manufacturer directory. Links are identified by their SOP
source; verify whether each is a claim form, portal or reference before using it.
If no link exists, enter the manufacturer's HTTPS form URL.

Use **Add manufacturer form** at step 3 to name and save a reusable portal/form
link or upload a blank PDF/Word (.docx) form (maximum 20 MB). Forms are stored in
the shared SOP Library under a manufacturer-specific Panel RMA Forms page,
independent of the case. Future requests show direct Open buttons and saved
document previews. Do not upload completed customer claims or passwords into
this shared template library. Existing forms can be maintained in SOP Library.
One-time links remain available in a collapsed section.

If the form window reports a missing handler, close all EnQuote windows, stop
the `desktop:dev` terminal with Ctrl+C, and run `npm run desktop:dev` again.
A UI reload cannot register new main-process handlers; installed copies need
the full desktop update. The wizard now shows these instructions instead of
the raw IPC error.

**Open** launches a separate EnQuote manufacturer window with no desktop bridge
or Node access. Complete forms and sign in manually there, then return to the
wizard; opening a website neither submits nor saves the tracker record. The
wizard's entries remain intact when moving Back/Next. Some manufacturer sites
may reject embedded browsers and require the normal browser instead. Downloaded
PDF/Word forms may require an external editor; EnQuote does not fill them
automatically. A full desktop restart/update is required for the new window bridge.

Every Panel RMA form includes **SOP-guided submission preparation**. It searches
the cached library's panel/module pages, including child pages, prioritizes the
selected manufacturer's pages, and keeps no-RMA warnings available. Identical
imported copies are collapsed; differing instructions remain separate so users
can review conflicts. The original SOP content, links, and attached forms can be
read in the form or opened in SOP Library.
Use **Refresh SOP guidance** to fetch the latest shared library. A refresh failure
is shown explicitly while cached instructions remain available.

Choose a page and **Add suggested checklist** to turn relevant written
instructions into user-confirmed preparation items. Conditional instructions
remain conditional; these suggestions are not manufacturer eligibility rules.
The page title, ID and revision are recorded as a reference. Changed or missing
references show a review warning. PDF/image/Word attachments can be opened but
are not automatically interpreted or added to a claim.
Use **Add item** to include instructions from attached forms in your checklist.

Record installation details, installer information, diagnosis and test results.
**Preview submission draft** and **Copy submission draft** combine those details
with the case/site, manufacturer, model, quantity, serials, notes, checklist and
SOP references. Missing information is explicitly marked for review. Save the
RMA to persist and share preparation details; copying alone does not save them.
Complete the manufacturer's current form, attach actual evidence files, and
submit manually using the original instructions. EnQuote does not send emails
or submit manufacturer claims.

### Executive Overview: daily Quote Backlog and overdue sorting

**Quote Backlog** now uses shared daily observations from the sync service,
independent of whether any desktop is open. Today stays live; previous Mountain
Time calendar days (`America/Denver`, including daylight saving) retain their
last saved observation. Changing today's quote status no longer recalculates
yesterday's stored count or rows. The tile shows the selected reporting period's
closing date, a status breakdown, capture time, and live/frozen state. Its record
view supports status filtering and numeric overdue-hours sorting.

The service samples once per minute. The frozen value is the last successful
observation that day, not a guaranteed exact-midnight transaction, and reflects
the quotes received by server sync at capture time. Source-sync delay or missed
captures can affect that timestamp. History begins when this service update is
deployed; dates without an observation show **N/A**, not a reconstructed count.
Yesterday's original count cannot be restored if it was never saved.

This tile retains its SLA-alert definition: current, reportable, non-held quotes
with an SLA alert, without user-specific mention/dismissal filtering. It differs
from Quote Operations' generic nonterminal start/end backlog. Warning alerts
and alerts without a timed deadline have zero overdue hours. **Alerts** remains
available; its list and the Quotes sort menu offer most/least overdue ordering.

Deployment requires database migration `0015_quote_backlog.sql`, the updated
Worker with its scheduled trigger, and the desktop's new backlog bridge. A
UI-only publication cannot enable the shared-history bridge.

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

### Supervisor Dashboard: Case work and paid invoices

Executive Overview includes **Cases Worked**, **Cases Closed**, **Cases Transferred
Out**, **Case Work Events**, **Sites Worked**, and **Case Ownership Needs Review**.
They support the normal reporting period, display modes, source filter, tile
visibility/reordering, and contributing-record links.

In **Report Data > Case Work History**, import the Salesforce Case History
Details Only CSV with Case Number, Field / Event, Old Value, New Value, Edited By,
and Edit Date. Enlighten Site ID is optional but needed for complete site counts.
Drop multiple compatible exports together to combine them. Each import replaces
the stored history table; overlapping event signatures are collapsed by the
calculations. Windows-1252 and UTF-8 CSVs preserve names and leading-zero identifiers.
The imported table uses existing Supervisor sync; no desktop/Worker schema change
is required.

Only owner transfers from the configured team to outside owners/queues and
non-Closed-to-Closed events with history-supported team ownership qualify.
Other status changes, creation, notes, subject/contact edits, incoming transfers,
and internal transfers do not count as work. Current Case Owner, Edited By, and
Project Picklist never substitute for historical ownership.
**Case-work team** lets each account review/update its Salesforce owner-name roster
on this device. The starting roster is the ten names supplied for this report.
Review the roster before using totals; membership changes recalculate history.
Viewing mode cannot save this preference.

Closure ownership uses the nearest earlier owner change's new owner and/or the
nearest later change's old owner, from the entire imported history, not just the
selected period. Missing/conflicting anchors or simultaneous owner changes go to
Needs Review, not confirmed totals. The export timestamp is interpreted in its
report calendar; use the same Salesforce report timezone for overlapping exports.
Minute-level exports cannot prove the order of changes within a minute.
Counts describe observed exported history, not guaranteed complete team activity.
Filtered or missing history may undercount even when a displayed number is zero.

Period totals count each case/site once. Daily Average averages distinct daily
counts across all calendar days, including zero days. Latest Day uses the selected
period end. Work Events count one episode per case/timestamp to avoid inflating a
simultaneous transfer/closure; repeat timestamps remain separate. A missing Site ID
does not remove the case from case counts but is excluded from site counts.
Drill-downs retain qualifying history rows for audit and load 100 rows at a time.

**Invoices Paid** is a quote count; **Paid Quote Total** is the combined quote
value in USD. Both use live EnQuote quotes currently in exactly these statuses:
Invoice Paid, Invoice Paid - Materials Required, Materials Pending Shipment,
or Scheduled. Only current versions not excluded from reporting qualify.
Both filter by recorded invoice paid date within the inclusive Reporting Period.
The preferred field is paid_at_date, with invoice_paid_date used when it is absent.
Timestamp dates use the viewer's local calendar, consistent with dashboard quote
activity; date-only values keep their calendar date. Creation and status-change
dates are not substituted for payment dates. Missing/invalid paid dates are
excluded with a visible count because they cannot be assigned to a period.
Latest Day uses the selected period end; Daily Average divides by all calendar
days in the period, including days with no payments. Each includes contributing
quote links, current status, paid date, case/site identifiers, and totals for audit.
They need no CSV and do not use the optional Paid Invoices import. Paid Quote
Total is quote value, not reconciled cash receipts. Missing/invalid matching quote
totals make the dollar amount unavailable with a visible warning rather than
silently reporting a partial total; the quote count remains available.

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
The UI can also read the current quote through the existing desktop bridge.
When its update timestamp matches the notice and no updater is recorded, the
last status-history entry supplies a clearly labeled "last status update by"
attribution. That author is not presented as the editor of unrelated fields.
Newer quote versions are never used to attribute older notices, and missing,
invalid or future-dated history is not used. This requires no installer update.
Notification times are displayed in the viewing user's local timezone, including
Base44 UTC timestamps that arrive without a timezone suffix.
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

Outline/ghost button labels, dialog headings, and close icons follow the active
light or dark theme throughout the app. Colored actions keep their semantic hues
with contrast-checked text, including hover states. Custom themes use the same
readability checks. Legacy slate/indigo styling follows the current theme rather
than fixed light-theme colors.

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
To change your picture, click your avatar in the sidebar. **Choose image** uploads
a photo (cropped to 256px) or your own animated GIF. **GIPHY** opens a search
(trending when empty); click a GIF, then **Use GIF**. GIFs keep playing
everywhere avatars appear. If GIPHY's normal size is over 512 KB, EnQuote
automatically uses GIPHY's smaller version. The sidebar "Signed in as" label shows
your real name; if the user directory is slow at sign-in, EnQuote retries in the
background and replaces the email with your name when it loads.
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
Shared quote links carry the quote reference as well as the record ID, so they can
open the same quote on a PC with a different synchronized local ID. Existing chat
links labeled with a quote reference also use this lookup. Task quote badges and
standard message quote attachments use their stored quote labels to recover the
reference, including existing tasks/messages created on another PC. Lookup checks
the exact local ID, synchronized Base44 ID, and unique quote number across the full
stored quote database, including older versions, regardless of visible list filters
or recent-page limits. It does not guess a quote from a site or case number.
The destination uses
the local record ID for edits and preserves the selected section's highlight.
When the reference has older versions and exactly one current version, reference
lookup opens that current version. Exact ID links still open the requested version.
If multiple current records match, **Choose quote version** lists matching records
with their versions, site/case, status, and IDs. Select the correct record rather
than having EnQuote guess. If all matching records are historical, they remain
selectable. The selected record keeps the shared section highlight.
Validate shared lookup with `node --test tests\sharedQuoteLink.test.mjs` and,
after building, `node scripts\smoke-test.cjs --quote-links-only`.
**Update Quote** saves independently of the editor screen. A confirmed save updates
the quote cache and displays **Quote changes saved**; navigating away does not cancel
the save or pull you back to the editor when it completes. Failures remain visible
as notifications. Local repository operations serialize their full read-modify-write
cycle, so status changes, navigation writes, and sync acknowledgements preserve items.
An acknowledgement for an older pushed revision leaves newer edits queued, and
inbound snapshots do not replace quotes with pending local edits. Saving locally
does not mean Base44 has acknowledged the edit yet; network errors/conflicts stay queued.
Desktop persistence fixes require a full desktop update, not only a UI hotfix.
The Quotes **Attention Required** box shows exactly the quotes counted by the
**Alerts** button, using the same SLA assignments, unresolved mentions, and
dismissals. It remains independent of search/status/coordinator filters so its
count matches the Alerts badge. The Alerts button still filters the main quote
list and is unchanged. The attention box retains View, Log, Dismiss, and collapse
controls; SLA timing or Mentioned replaces the old separate day-threshold list.
The main Dashboard does not display Coaching Feedback or Attention Required.
Quote alerts remain available on the Quotes page; this does not delete feedback
or dismiss any alerts.
Chat emojis insert at the message cursor, both in Messages and in the chat dock.
Built-in emojis are text; custom emojis display inline in the composer and sent
messages. Backspace/Delete removes them, and Ctrl+Z undoes insertion. GIFs,
screenshots, and shared items remain separate attachments. Older emoji
attachments still display normally. Custom emoji references count toward the
existing 4,000-character message limit.
Minimized chat tabs use a transparent dock background and cap their corner radius
at 12 px so the maximum theme radius does not distort the tab or close control.
The message launcher remains circular.
The UI-only emoji update does not change Windows notification formatting;
notifications may display the custom emoji reference instead of its short name.
Auto-Drafter details use the draft reference, or the real quote number once sent.

In EnSpace, **Games** in the top quicklinks bar opens an arcade with Snake,
icon-based Memory Match, Tic-Tac-Toe against the computer, draw-one Klondike
Solitaire (with Undo), and **Neon Rider**, an original draw-and-ride track toy.
Snake uses arrow keys/WASD or
direction buttons and pauses when the board loses focus or the window is hidden.
Space toggles pause while the board is focused. Each game has a New game button;
leaving a local game resets it. Snake glides between grid steps while retaining
grid-based steering and collisions. Neon Rider supports maps up to 14,400 x 8,000,
Expand map, Zoom in/out, Fit map, Pan map, View start, and Follow rider controls.
Its local tracks reset when leaving the game. It is not the official Line Rider.
Games do not change work records.
The arcade has an '80s neon-cabinet look with pixel-style lettering and static
scanlines, with no flashing effects or external fonts.
**Challenge a teammate** opens online Tic-Tac-Toe, turn-based Memory Match,
Connect Four, Battleship, and Checkers.
Connect Four, Battleship, and Checkers also have dedicated arcade tiles marked
Online / 2 Players / Auto-Saved. Their Play buttons open challenges with that
game preselected; existing saved matches remain accessible through Open match.
The teammate list shows published EnSpace profiles by name and email, excludes
your own profile, and loads every directory page. When the games service is
available, only profiles whose email is on the allowed teammate list can be chosen.
If the games Worker/migrations are unavailable, profiles still load but Send challenge
stays disabled and the service error remains visible. Refresh or reopen after deployment.
Choose a teammate and game; invitations appear in their Games lobby,
which refreshes every five seconds. The recipient can accept or decline;
the sender can cancel a pending invite. The sender goes first. Memory matches
earn another turn; misses display briefly before passing play to the other person.
Matches and turns are verified by the Worker, with hidden cards withheld.
Connect Four uses a seven-column, six-row board with gravity and four-in-a-row wins.
Battleship uses private 10 x 10 boards with five ships of lengths 5, 4, 3, 3, 2.
Select a ship and orientation, then click its starting cell, or use Randomize fleet.
Each placement is saved immediately. Ready to battle locks the fleet; both players
must be ready before firing one shot per turn. Unhit enemy ships are never sent
to the opponent. Checkers follows American rules: compulsory captures, multi-jumps,
forward-only ordinary pieces, kings moving both ways, and promotion ending a turn.
Capturing all pieces or blocking every enemy move wins; 80 turns without a capture
or promotion is a draw.
You can close Games or EnQuote and return using **Open match**, or resign.
Every confirmed action saves the board, turn, and private setup in the shared database.
Wait for Saving to finish before closing; errors mean the action is not confirmed.
Active matches never expire and remain listed regardless of inactivity.
Invites expire after 24 hours. The lobby also shows up to 100 nonactive matches
updated within the last seven days. These are private matches,
not a public leaderboard.

**High scores** shows team-wide top-ten leaderboards and your personal best on
this PC. Snake ranks the highest completed-run score; Memory Match and Solitaire
rank the fewest moves in a completed game. Scores save automatically at game end,
never from an unfinished Memory Match or Solitaire game. Personal scores are
scoped to the signed-in user. Failed shared uploads show an explicit Retry action;
**Sync personal bests** on the High scores screen uploads personal bests saved
while offline. Completing another game also retries that game's saved best.
Scores are authenticated, bounded, and update each player's best atomically, but
local-game results are honor-system submissions, not anti-cheat verified replays.
Online matches and the Neon Rider sandbox are not scored.

Online challenges require a **full desktop release**, not a UI-only hotfix,
because they add preload/main-process handlers. Before releasing that installer,
apply the games migration and deploy the Worker from `enquote-sync-worker`:
`npx wrangler d1 execute enquote-sync --file=.\migrations\0012_retro_games.sql --remote`,
`npx wrangler d1 execute enquote-sync --file=.\migrations\0013_retro_scores.sql --remote`,
`npx wrangler d1 execute enquote-sync --file=.\migrations\0014_retro_strategy.sql --remote`,
then `npm run deploy`. Local games remain usable on older desktop builds; online
play shows upgrade guidance when the desktop handlers are unavailable.
Validation: `node --test tests\enSpaceGames.test.mjs tests\arcadeExtraGames.test.mjs tests\arcadeScores.test.mjs`,
Worker `node --test test\retro-games.test.js test\retro-scores.test.js`, and, after building,
`node scripts\smoke-test.cjs --arcade-only`.
Task contact phone numbers have a **Copy phone number** button that copies only
the number, preserving its formatting. Copy success or failure appears as a
notification; the number can also be selected and copied manually.
Validate task clipboard behavior and repeated navigation with
`node scripts\smoke-test.cjs --stability-only` after building.
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
Long message text and shared EnQuote link labels wrap inside the chat, including
narrow resized windows. Minimized conversation name buttons fill the tile's
height; click anywhere in the name area to reopen it. The separate X closes it.
Reaction badges use larger 28px artwork so custom animated emojis are easier to
recognize. Opening a shared Workload case row switches to **All Cases** and clears
search, tile, Review Me, and column filters so the row can be revealed. This does
not change saved customization preferences or grant access to unavailable data.
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

Web links in SOP pages, version-history previews, and Word attachments open
separately in your browser, rather than replacing the EnQuote window. **Open
original** behaves the same way. Return to EnQuote to continue from the selected
SOP. Links to sections within an SOP scroll inside that page without changing
EnQuote's route.

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
