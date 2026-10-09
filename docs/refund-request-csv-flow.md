# Enphase Care Refund Requests: Forms CSV import

The Enphase Care page includes **Active Subscriptions**, **Submit Request**, and
**Refund Requests** tabs. Requests submitted in EnQuote go directly to the shared queue.
Microsoft Forms exports can be automatically added to the same queue from a SharePoint or
OneDrive folder using Power Automate.

In **Refund Requests**, use the labeled dropdowns to filter by status, department,
refund type, and leadership approval. Each dropdown's **All** option clears only
that filter; search and submitted-date filters continue to apply.

## Power Automate file flow

Create an automated cloud flow:

1. Use the SharePoint or OneDrive trigger for a file created in the folder receiving the
   **Enphase Care Refund Request** Microsoft Forms CSV export. Limit it to `.csv` files.
2. Add **Get file content**, using the trigger's file identifier.
3. Add an HTTP POST action with:
   - URI: `https://enquote-sync.croeschberger.workers.dev/api/refund-requests/ingest-csv`
   - Header `Content-Type`: `text/csv; charset=utf-8`
   - Header `Authorization`: `Bearer <REFUND_INGEST_TOKEN>`
   - Body expression:

     ```text
     base64ToString(body('Get_file_content')?['$content'])
     ```

Store `REFUND_INGEST_TOKEN` in a secured Power Platform environment variable or connection
configuration, not in flow inputs or source control. Configure the same token as a Cloudflare
Worker secret. The request data is sent directly from the flow to the Worker; EnQuote does not
need Microsoft Graph credentials or direct SharePoint access.

The importer accepts standard UTF-8 Microsoft Forms CSV exports, including quoted commas and
multiline fields. It uses the Forms `ID` column as an idempotency key, so retrying the same CSV
does not create duplicate requests. Files are limited to 1 MB and 100 response rows.

| Request field | Accepted CSV column headers (case-insensitive) |
| --- | --- |
| Response ID | `ID`, `Response Id`, `Response ID` |
| Submitted date | `Completion time`, `Submitted At`, `Submitted Date`, `Submission Date`, `Start Time` |
| Requestor name / email | `Name` / `Email`, or `Requestor Name` / `Requestor Email` |
| Department | `Requestor Department`, `Department` |
| Subscription / site / customer | `Subscription ID`, `Site ID`, `Customer Name` |
| Amount / reason | `Refund Amount Requested`, `Refund Amount`, `Amount Requested`; `Refund Reason`, `Reason for Refund` |
| Site visit / refund type | `Site Visit Completed`, `Was Site Visit Completed`; `Refund Type` |
| Leadership approval | `Leadership Approval Required`, `Leadership Approval`; `Leadership Approval Justification` |
| Notes | `Additional Notes`, `Notes` |

Forms questions should use the names above or one of the aliases. Boolean fields may be
`Yes`/`No`, `True`/`False`, or `1`/`0`. Refund type must be `Full Refund` or `Partial Refund`
(or `Full`/`Partial`). The amount must be numeric, optionally with a currency symbol. If
leadership approval is not required, leave its justification empty.

The importer validates every data row before writing any of them. On bad data it returns HTTP
400 with the one-based CSV line numbers that need correction. A successful response includes
`created`, `duplicates`, and `total` counts.

## Worker setup

Apply the refund-request migration and configure the ingestion secret before enabling the flow:

```powershell
npx wrangler d1 execute enquote-sync --remote --file=migrations/0010_refund_requests.sql
npx wrangler secret put REFUND_INGEST_TOKEN
npx wrangler deploy
```

If migration `0010_refund_requests.sql` has already been applied to the production D1 database,
do not apply it again. The `/ingest-csv` endpoint uses the same dedicated ingestion secret as
the existing single-response `/ingest` endpoint; both endpoints are write-only.
