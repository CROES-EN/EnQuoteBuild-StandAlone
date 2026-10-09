# Virginia's refund tracker -> shared EnQuote tracker

**Current release: refund features are disabled pending IT approval of the integration.**
The native form, refund queue, and desktop refund IPC operations are unavailable. Existing
data, workbook settings, scripts, and audit history are retained. This flow has not been
installed or enabled. Re-enable only after the approved integration has been tested.

This scheduled **cloud flow** reads Virginia's live response workbook and mirrors it into
the shared workbook. Virginia's tracker is authoritative for every column it supplies.
Nothing is written back to Virginia's file. This replaces the previously discussed
two-way workbook link.

## Files and scripts

- Source: [Virginia's live tracker](https://enphase-my.sharepoint.com/personal/vseganos_enphaseenergy_com/Documents/Documents/Copilot/Created/Refund_Request_Tracker%26Processing%20_Care.xlsx?web=1),
  document ID `14EF52C5-B692-4E6D-A562-9193E6BD2F1E`.
- Target: [shared EnQuote tracker](https://enphase.sharepoint.com/sites/CustomerFinancingandOMMarketplace/_layouts/15/Doc.aspx?sourcedoc=%7B3461ADB8-859C-49D5-9A6B-4E65F3BD5895%7D&file=EnQuote_Care_Refund_Tracker.xlsx&action=default),
  document ID `3461ADB8-859C-49D5-9A6B-4E65F3BD5895`.
- Source script: [Read Virginia refund tracker](../scripts/power-automate/readVirginiaRefundTracker.ts).
- Target script: [Mirror Virginia refund tracker](../scripts/power-automate/mirrorVirginiaRefundTracker.ts).

Both workbooks must contain `Table2` with unique, nonempty `ID` values in populated rows.
Completely blank rows are skipped. Do not use the stale local O&M copy as the source.

## Install the Office Scripts

Use Excel for the web, **Automate -> New Script**, paste each complete script, and save it
under the names above. These are two separate scripts, not VBA macros or a PowerShell file.
Save scripts in the flow owner's work OneDrive. Office Scripts and their use in Power
Automate must be enabled/licensed by your organization.

The flow connection needs access to read Virginia's workbook and edit the shared workbook.
Prefer Virginia as the flow owner if her personal OneDrive file is not selectable through
your connection. This uses **Excel Online (Business)**, with no HTTP action, Premium HTTP
trigger, desktop OneDrive folder, Graph app registration, or EnQuote secret.

## Build the scheduled flow

1. In Power Automate select **Create -> Scheduled cloud flow**.
   Name it **Virginia refund tracker to EnQuote** and repeat every **5 minutes**.
2. In **Recurrence -> Settings**, enable **Concurrency control**, degree **1**.
   Do not use workbook-modified triggers: target updates can otherwise create loops.
3. Add **Excel Online (Business) -> Run script**, rename the action
   `Read_Virginia_tracker`.
   - Location: Virginia's **OneDrive for Business**.
   - Library: **OneDrive**.
   - File: her actual `Documents/Copilot/Created/Refund_Request_Tracker&Processing _Care.xlsx`.
     Select the live file, not a downloaded copy or `.url` shortcut.
   - Script: **Read Virginia refund tracker**.
4. Add **Excel Online (Business) -> Run script**, rename it `Mirror_shared_tracker`.
   - Location: SharePoint site **Customer Financing and O&M Marketplace**.
   - Library: **Documents**.
   - File: `Care - Cancel requests/EnQuote_Care_Refund_Tracker.xlsx`.
   - Script: **Mirror Virginia refund tracker**.
   - `snapshotJson`: select **result** from `Read_Virginia_tracker`, or enter:

     ```text
     body('Read_Virginia_tracker')?['result']
     ```

   Keep default **run after successful**. Never replace a failed read with an empty
   snapshot: that would incorrectly interpret a read failure as source deletions.
   Set the target action's retry policy to **None**. A failed run must restart with a
   fresh source read; snapshots expire after ten minutes.
5. Add an email/Teams failure notification configured to run after either script
   fails or times out. Send a link to flow run history, not customer data.
6. Save, then run **Test -> Manually** once. The target script returns JSON with
   `added`, `updated`, `deleted`, and `sourceRows`. Check those counts and both workbooks
   before enabling the recurrence.

This repository contains the scripts and instructions, not a deployed/importable flow
package. Connection references and workbook selectors must be configured in your tenant.

## Updates and deletions

- IDs are matched as trimmed text, so numeric Forms ID `6` matches shared ID `"6"`.
- All columns present in Virginia's table are copied, including cleared cell values.
  Target-only columns remain unchanged. Date/number display formats are copied.
  Formula-like answers are written as literal text rather than executed.
- `EnQuote Virginia Source ID` marks flow-owned target rows. Do not edit that column.
- Once copied, a row deleted from Virginia's tracker is deleted from the shared tracker
  on the next successful run. First setup does not delete unmatched/unmarked target rows.
  Rows created only by EnQuote are not in Virginia's tracker and are not adopted or
  removed by this flow.
- With the updated EnQuote desktop app open on **Refund Requests**, deletion of a
  previously synced shared row removes its matching tile. Let OneDrive finish downloading.
  New source IDs appear as new tiles after workbook sync.
- **Source of truth means source edits win**: changes to source-owned fields made only
  in EnQuote or the shared workbook are overwritten on the next flow run. The native
  EnQuote form still writes only to the shared tracker; it does not submit to Microsoft
  Forms or Virginia's workbook. For an authoritative intake, use the real Microsoft Form.
  If EnQuote reports a same-field conflict, choose **Use workbook** to accept Virginia's
  mirrored value; the flow does not bypass EnQuote's conflict protection.
- Previously deleted EnQuote IDs retain tombstones. Reusing an old deleted Forms ID
  will not restore its tile; continue with new response IDs or arrange an explicit restore.

## Safe operation and limits

The script validates the complete snapshot and target IDs before writing. Empty source
tables are valid and delete only previously marked rows. Missing tables, bad IDs, stale
snapshots, and excessive input throw errors rather than silently succeeding.

Excel Online and desktop Excel/EnQuote must not write the shared workbook concurrently.
Concurrency degree 1 prevents overlapping runs of this flow only; it does not lock
EnQuote, OneDrive, other flows, or human editors. Coordinate a single writer, close desktop
Excel, and avoid running EnQuote's automatic write sync during the flow's run. Office
Scripts changes are not transactional; after partial failure rerun from a fresh read.
ID upserts and marker-based deletes make reruns convergent rather than duplicating rows.
Keep workbook version history enabled and take a backup before the first run.

Limits in these scripts: 5,000 populated source rows, 500,000 JSON characters, ten-minute
snapshot age. Power Automate/Excel tenant limits may be lower. A five-minute recurrence
is deliberate; very frequent script runs can exceed connector quotas.

The old Microsoft Forms banner on the shared copy does not matter: this flow reads the
real response workbook explicitly. Verify the real Form still writes to the source file
above before enabling the flow; copying a workbook never changes its Forms connection.
