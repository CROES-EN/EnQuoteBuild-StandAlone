# Enphase Care refund tracker synchronization

**Refund features are currently disabled in the desktop release pending IT approval.**
Active Subscriptions remains available. The workflows below describe the retained
implementation, not currently enabled desktop functionality.

For the cloud flow using Virginia's tracker as the authoritative source, see
[Virginia tracker Power Automate setup](refund-tracker-power-automate.md). That flow is
one-way into the shared tracker, not a two-way link or a native EnQuote form submission
into Microsoft Forms.

EnQuote synchronizes refund requests with the SharePoint workbook through each authorized
processor's OneDrive-synced copy. This avoids a Premium Power Automate HTTP trigger and does not
require an Entra app registration. EnQuote reads and writes one workbook locally through
Windows desktop Excel automation.

## One shared Excel tracker

The team copy is **EnQuote_Care_Refund_Tracker.xlsx** in **Customer Financing and O&M
Marketplace → Documents → Care - Cancel requests**:

[Open the shared tracker](https://enphase.sharepoint.com/sites/CustomerFinancingandOMMarketplace/_layouts/15/Doc.aspx?sourcedoc=%7B3461ADB8-859C-49D5-9A6B-4E65F3BD5895%7D&file=EnQuote_Care_Refund_Tracker.xlsx&action=default).

This copy is independent of Virginia's original workbook. Copying the file does **not**
redirect the old Microsoft Form's responses to it. Submit new requests through EnQuote.
No CSV destination or report-source setup is needed.

1. Add the **Care - Cancel requests** folder as a shortcut to **My files** in OneDrive,
   using your work account, and wait for desktop OneDrive to download it.
2. Fully quit and restart the updated EnQuote desktop app. Sign in to both EnQuote and
   OneDrive with the same work account, with EnQuote invoicer/admin access and SharePoint
   edit permission. Windows desktop Excel must be installed.
3. Open **Enphase Care → Submit Request**. EnQuote automatically connects the shared
   `EnQuote_Care_Refund_Tracker.xlsx` under `<work OneDrive root>\Care - Cancel requests` or
   `<work OneDrive root>\Customer Financing and O&M Marketplace - Care - Cancel requests`
   (SharePoint may prefix the shortcut name with the site name). There is no file picker.
   Old workbook connections migrate to this shared tracker, resetting their sync baseline.
   If the shared file is unavailable, EnQuote reports the OneDrive prerequisite and checks
   again every 30 seconds while either refund tab is open; it never writes to an old fallback.
4. Fill out the form and select **Submit request**. EnQuote saves the request to its queue,
   then upserts the corresponding Excel row by response ID.
5. Open **Refund Requests** to read workbook changes. While this tab is active and visible,
   the connected workbook syncs immediately and every 30 seconds. Edits saved in EnQuote
   trigger writeback; **Sync tracker** also runs manually and retries pending edits.

Any authorized processor can connect the same team file from their own Windows profile.
Coordinate **one active writer/PC at a time**, close Excel before writes, and wait for
OneDrive to upload/download changes before another person opens the Refund Requests tab.
Same-process operations are serialized, but there is no cross-PC locking or live cloud
freshness check. EnQuote cannot sync while closed. A sharing URL is not a local file path.

Excel processes a temporary, nonsynced snapshot to avoid Office/OneDrive failures opening
the SharePoint shortcut directly. Successful writes are published with a same-directory
atomic replacement under a local file lock, only if the original file's SHA-256 still
matches the snapshot. If another edit arrived during processing, publication is rejected
without overwriting it. Temporary snapshots and replacement/backup files are cleaned up.
This remains local-file coordination, not a distributed SharePoint lock.

## Native request form

**Submit Request** now uses an EnQuote-native form matching the live Microsoft Forms
questions and branching inspected on October 9, 2026. It does not submit to Microsoft Forms
and needs no Microsoft sign-in window. EnQuote authenticates the requester using its verified
account, ignoring requester identity supplied by the renderer.

The renderer imports the shared CommonJS question schema using the `enquote-refund-form`
Vite alias, explicitly prebundled for development. After changing Vite configuration,
restart `npm run desktop:dev` so the development server reloads its dependency configuration.

The form asks cancellation timing and refund choice first. A refund requires answering
**Services completed** before the remaining questions appear; **No refund** skips that
question. Customer escalation, site/subscription IDs, customer name/email, case number,
and primary reason are required. **Other** reveals its required explanation. Selecting any
reason reveals the required detailed explanation. All eight original reason choices are
retained. The live form has no refund-amount, department, site-visit, or leadership-approval
questions; these EnQuote-only values remain missing rather than being invented.

Pending submissions are saved per verified EnQuote account on this PC. If Excel fails after
the server save, EnQuote reports **saved to EnQuote, Excel pending**. Close Excel, wait for
OneDrive and choose **Retry Excel submission**. Pending state survives restart and reuses
the same submission ID after a lost server response. Excel upserts by ID rather than adding
a duplicate. Retry fetches the latest saved request so newer workflow edits are preserved.
New submissions and destination changes are blocked until the pending submission finishes.
Pending submissions tied to an older destination are not silently redirected to the shared
tracker; contact your administrator to recover that pending submission before submitting anew.
Processor access is checked on both submission and retry.

Status/detail edits are saved first in EnQuote. A failed Excel write explicitly reports that
the save succeeded but synchronization is pending; use **Sync tracker** to retry. Approvers
without processor access can save authorized approvals, but a processor must sync them to Excel.
The workbook must contain `Table2` and an `ID` column.

## Synchronization behavior

- Workbook rows with an `ID` not yet in EnQuote are imported, including incomplete Forms rows.
  EnQuote lists missing values in `missingEnQuoteFields` and flags those requests as needing
  completion; it does not invent missing business values. Completely empty table rows are
  ignored. Populated rows without an `ID`, or rows with duplicate IDs, block sync and are
  reported by their 1-based position within the table.
- EnQuote-only requests are added to the workbook. EnQuote adds columns for request-specific
  fields and sync metadata as needed.
- Removing a previously synced row from Excel removes its matching EnQuote tile on the
  next sync. A request is eligible only after this PC has a successful sync baseline for
  it; missing rows on first connection are not treated as deletions of new submissions.
  Server version checks reject deletions racing a newer EnQuote edit. Deleted requests
  retain their original data and audit trail as recovery tombstones, excluded from the
  active queue; stale workbook copies and retries cannot resurrect them. Stale deleted
  rows are removed from Excel when synced. Wait for OneDrive to finish downloading before
  syncing: local coordination cannot prove cloud freshness or prevent cross-PC races.
- Nonconflicting workbook and EnQuote edits are merged field by field.
- Status filters and editors use **Submitted**, **Under Review**, **Approved**, **Denied**,
  **Completed**, and **Cancelled**. Legacy `New` maps to `Submitted`; `Processed` and `Closed`
  map to `Completed`. Editors expose every status rather than only the next workflow step.
  Approver/admin access is required for `Approved`; processor/admin access is required for
  the other statuses. Completion still requires leadership approval when the request needs
  it, and preserves a previously entered paid-at date.
- If both sides changed the same field since the last successful sync, EnQuote leaves that
  field unchanged and shows **Use workbook** and **Use EnQuote** choices for an authorized
  processor to resolve it.
- A stale Worker record version is not written to Excel. Sync again to refresh and review any
  resulting field conflict.
- Workbook sync and workflow updates are restricted server-side to users with Enphase Care
  access and an `invoicer` or administrator role. The SharePoint permission is enforced by the
  OneDrive account syncing the file. EnQuote also checks that the signed-in EnQuote email
  matches the work account configured for that OneDrive sync folder. OneDrive applies the
  SharePoint ACL when syncing; EnQuote does not make a separate live SharePoint permission
  query. Remove workbook access in SharePoint when an operator should no longer edit it.
  Worker imports and edits are audited.
- Excel automation writes numeric values using Excel-compatible doubles, including integer
  refund amounts. A read-only workbook blocks writes explicitly. Failed writes are closed
  without saving partial changes. Before opening for writing, EnQuote checks local exclusive
  write access; errors distinguish opening, updating, and saving. Close the tracker in Excel
  and wait for OneDrive before retrying. This local check is not a cross-PC lock.

The desktop app stores the automatically resolved shared workbook path and field-level sync
baseline in its local application data directory. The baseline is specific to that workbook.

## Workbook mapping

The existing table uses these request columns:

| Workbook column | EnQuote field |
| --- | --- |
| `ID` | `externalResponseId` |
| `Start time` / `Completion time` | `submittedAt` |
| `Requester Email` | `requestorEmail` |
| `Requester Name` | `requestorName` |
| `Customer name` | `customerName` |
| `When should the Enphase Care plan be canceled?` | `cancellationTiming` |
| `Is a refund also being requested?` | `refundChoice` |
| `Services completed` | `servicesCompleted` |
| `Is the customer escalated?` | `customerEscalated` |
| `Customer email address` | `customerEmail` |
| `Case number` | `caseNumber` |
| `Add reason if the "Other" is selected` | `otherReason` |
| `Subscription ID` | `subscriptionId` |
| `Site ID` | `siteId` |
| `Refund amount (USD)` | `refundAmountRequested` |
| `Primary reason for the cancel and/or refund request` | `refundReason` |
| `Detailed explanation of the refund request` | `additionalNotes` |
| `Manager Approved` | `managerApproved` |
| `Status` | `status` |

EnQuote adds columns for requestor department, refund type, site visit, leadership approval,
store-team and escalation notes, paid-at date, approver/processor, approval date, last update,
and sync status.

## Worker and licensing

The desktop app uses its existing authenticated Worker connection. The Worker endpoint
`POST /api/refund-requests/workbook-sync` accepts local workbook imports and updates from
authorized EnQuote clients; it does not access Microsoft Graph or store SharePoint credentials.
No `REFUND_TRACKING_FLOW_URL` is needed for EnQuote submissions.
`POST /api/refund-requests/submit-native` validates the native form and deduplicates retries
by a user-scoped submission ID. Deploy the updated Worker before using the native form;
no additional database migration is needed.

The separate Forms ingestion endpoints (`/api/refund-requests/ingest` and
`/api/refund-requests/ingest-csv`) remain available for secured machine-to-machine ingestion
using the `REFUND_INGEST_TOKEN` Worker secret. Do not put that token in the desktop renderer,
workbook, or source control. Review and apply pending D1 migrations in order before deploying
Worker changes.
