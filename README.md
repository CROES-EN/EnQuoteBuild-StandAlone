# EnQuote
Internal quote generation platform for Enphase Operations & Maintenance services.

## Supervisor Dashboard

A tabbed home for the **O&M Daily Operations Snapshot** - the prior-business-day leadership
report covering contact center, staffing, quote operations, O&M case backlog, Enphase Care, and
blockers/escalations. A single "Viewing day" date picker at the top of the page drives every tab.

This dashboard is completely independent of Base44 — it never reads or writes any Base44/quote
data (except the read-only, live-computed Quote Operations figures described below), and works
identically no matter which `VITE_DATA_SOURCE` the rest of the app is running under (`base44`,
`base44-dual`, `local`, `salesforce`, or `mock`). Its manually-entered/imported data lives in its
own local collection (`supervisorDailyMetrics`), persisted to the same on-disk JSON file the
desktop app already uses for local data (or to browser `localStorage` as a fallback when
previewing outside Electron).

### Tabs

- **Overview** - the original Calls+AHT / Emails Worked / Quotes Drafted / Staffing scorecard,
  trends, and history table.
- **Contact Center** - calls offered/handled/abandoned, AHT, average wait time, emails
  received/worked, email backlog start/end (backlog start/end stay manual-only - they're
  point-in-time queue snapshots, not values that sum sensibly across an export's rows), plus
  computed Abandon Rate and Handle Rate. Supports manual entry and file import.
- **Staffing** - team headcount, scheduled/available staff, absences, training/meeting capacity
  loss, productive hours, plus computed Staffing Availability Rate. Supports manual entry and file
  import (from a NICE CXONE Workforce Management export) - no live API integration exists yet.
- **Quote Operations** - Salesforce Quotes Received supports manual entry and file import.
  Quotes Drafted, Quotes Completed, and Quote Backlog (start/end) are instead computed **live**
  from EnQuote's own local Quote + `status_history` data (see
  [`src/features/supervisorDashboard/quoteOpsMetrics.js`](src/features/supervisorDashboard/quoteOpsMetrics.js))
  so they can never go stale, and are never importable/editable directly. "Completed" is an
  adjustable status set (defaults to Invoice Paid + Scheduled); whichever set is chosen is always
  shown on the report. Unreconciled Quote Requests is an approximation (raw count difference), not
  a true Case Number ↔ Quote ID match.
- **Case Backlog** - new cases received and cases completed support manual entry and file import;
  backlog at start/end stay manual-only (point-in-time snapshots, same reasoning as Contact
  Center's email backlog). No live Incorta integration exists yet.
- **Enphase Care**, **Escalations** - every numeric field supports manual entry and file import
  (from the relevant tracker/report export); Escalations' free-text fields (major blockers,
  leadership action required, travel/field blockers) stay manual entry only. No live integration
  exists for any of these source systems yet.
- **Daily Snapshot Report** - composes every tab above for the selected date into the source
  spec's exact report structure (guarded calculations that show "N/A - Source unavailable"
  instead of a fabricated number, a Data Quality & Exceptions section, and an auto-drafted/
  editable Executive Summary), with Copy/Download as Markdown and Export as PDF. See
  [`src/features/supervisorDashboard/omSnapshotCalculations.js`](src/features/supervisorDashboard/omSnapshotCalculations.js)
  and
  [`src/features/supervisorDashboard/omSnapshotExport.js`](src/features/supervisorDashboard/omSnapshotExport.js).
- **Report Inventory** - a read-only reference of every source dashboard/spreadsheet named in the
  spec (links, what each one is authoritative for, and the source-of-truth rules), so a
  supervisor always knows where a number should come from even when this app doesn't automate it.

### Getting data in

1. **Import a report** (`src/components/supervisor/ImportReportDialog.jsx`) - upload a CXONE/NICE,
   Salesforce, Incorta, Enphase Care, or escalations tracker report export (`.xlsx`, `.xls`, or
   `.csv`). The dialog auto-detects the header row and suggests column mappings (editable,
   grouped by report area) covering nearly every numeric field across every tab (see
   `FIELD_DEFINITIONS` in `reportParsing.js` for the exact list), then aggregates rows into one
   record per calendar day. Every mapped field is a straight **sum** (or, for AHT/average wait
   time, a calls-weighted average) of exactly what's in the file - imports never recompute,
   derive, or fabricate a value, and a field left unmapped always comes out untouched/`null`.
   A handful of point-in-time snapshot fields (email/case backlog start & end) and all of
   Escalations' free-text fields stay manual-only - see each tab's description above.
2. **Manual entry** - each tab (other than Overview, Quote Operations' live figures, Daily
   Snapshot Report, and Report Inventory) is an always-visible inline form for the selected day,
   saved directly - no separate "edit" dialog required. `DailyMetricsForm.jsx` remains available
   from the Overview tab for quick manual entry/correction of the original four fields.

Imports and manual edits **merge by date** instead of overwriting each other - e.g. importing a
CXONE report (Calls/AHT) and later a Salesforce report (Quotes Received) for the same day combines
both into one record rather than one clobbering the other, and saving/importing into one tab never
touches another tab's fields for that same day. See
[`src/features/supervisorDashboard/opsMetricsStore.js`](src/features/supervisorDashboard/opsMetricsStore.js)
for the full record shape and merge rules and
[`src/features/supervisorDashboard/reportParsing.js`](src/features/supervisorDashboard/reportParsing.js)
for the file-parsing/aggregation logic.


