# Enphase Care Refund Requests: IT Handoff and Operations Runbook

**Prepared:** October 16, 2026

**Status:** Preparation / pre-production validation; not activated

**Business contact and current flow owner:** Carsten Roeschberger

**Audience:** IT, Power Platform administrators, application support, and refund process owners

## 1. Summary

The proposed solution consolidates Enphase Care cancellation/refund requests into a
dedicated SharePoint List. Microsoft Forms and, eventually, EnQuote will be intake
sources. Authorized staff will track review and processing in that shared list.

The **production Forms-to-SharePoint intake flow has been built and saved**, including
duplicate protection and a Teams failure-notification action. It remains **Off**, with an
additional always-false trigger condition. An authorized isolated cloud test verified
basic intake, numeric amounts, duplicate replay, and failure alerts; see section 12.
No production requests or production runs were created. Production acceptance is still
required; the test-copy mapping corrections have not been applied to production.

**EnQuote-to-SharePoint submission and SharePoint-to-EnQuote synchronization are not yet
operational.** Browser entry points and an offline-tested, dormant Graph transport have
been added locally (section 13). Microsoft authentication, IPC/caller authorization,
durable retry orchestration, and native queue integration remain unfinished. The retained
native EnQuote refund service still targets the older Excel-backed workflow. Do not
enable that service as a shortcut to the new architecture.

This is a request-tracking solution. It does **not** issue payments, reverse charges,
cancel subscriptions, or grant approval automatically.

### Current readiness

| Component | Current state | What remains |
|---|---|---|
| Dedicated SharePoint List | Production empty; isolated copy exercised successfully | Production permissions review, retention policy |
| Forms intake flow | Production Off/guarded; isolated intake and replay passed after mapping fixes | Promote approved fixes, complete validation matrix, controlled acceptance/pilot |
| Teams failure alert | Actual delivery verified from isolated flow to approved meeting chat, posting as User | Production connection/configuration acceptance and operational monitoring |
| Flow structure check | Earlier saved check: 0 errors, 0 warnings; production details later showed a potential-problem advisory | Reopen Flow checker and resolve current diagnostics before pilot |
| Native refund amount | Local code updated and tested | Coordinated Worker and desktop deployment |
| Enphase Care tabs | Local browser links to original Form and production List; explicit intake-off warning | Publish the UI changes through the normal release process |
| Native SharePoint submission | Dormant transport and validation tests added; no runtime wiring | Approved authentication, caller identity, durable submission/retry orchestration |
| Shared queue synchronization | Transport can page records and conditionally patch; no native queue wiring | Authorized UI mapping, roles, refresh, conflict handling, live acceptance |
| Production activation | Not authorized or performed | IT/business acceptance and release approval |

Restored tabs do not indicate that the integration is live. While native refunds are
disabled, refund tabs open Microsoft pages in the system browser rather than mounting
the operational native form or queue. The original Form can record responses, but its
production flow remains Off: those responses do not automatically reach the new List.

## 2. Scope and change constraints

- Additions only to the existing SharePoint environment.
- Leave existing workbooks, Form questions, existing records, navigation, and permissions
  unchanged unless separately approved.
- Do not run the old Excel mirroring design alongside a new list-authoritative design.
- Do not import historical records, delete records, or reset tracking data without approval.
- Use synthetic data for testing. Never put customer information into chat alerts,
  screenshots, test evidence, or this document.
- No monetary processing or subscription cancellation is included.
- Premium licensing does not by itself approve data movement, connector use, or external
  services. IT must review tenant policies and the final EnQuote integration.

## 3. Resource inventory

These are administrative/resource identifiers, not credentials. Authentication is still
required to access them. No signed HTTP trigger URLs, bearer tokens, or passwords belong
in this document.

### Microsoft resources

| Resource | Name / identifier |
|---|---|
| Power Platform environment | Enphase Energy (default) |
| Environment ID | `Default-7df9352f-c5eb-4007-a723-44c078605c7a` |
| Flow | Care Refund Requests - Forms Intake |
| Flow ID | `90a0b82e-65cd-460e-bf7f-249ff9624670` |
| SharePoint site | Customer Financing and O&M Marketplace |
| List | Care Refund Requests |
| List ID | `a3632928-dfa6-4e85-91b8-8d2de6ddc996` |
| Processing view | Refund Processing |
| Form | Enphase Care Cancel/Refund Request Tracking (Copy) |
| Form ID | `LzX5fevFB0CnI0TAeGBcemFBFqB54EFOo3V5rhDHnAJUOUVaT1hEUFlESUtaV0dMQzlBSUNaRVRaVS4u` |

Administrative links:

- [Flow details and run history](https://make.powerautomate.com/environments/Default-7df9352f-c5eb-4007-a723-44c078605c7a/flows/90a0b82e-65cd-460e-bf7f-249ff9624670/details)
- [SharePoint processing view](https://enphase.sharepoint.com/sites/CustomerFinancingandOMMarketplace/Lists/Care%20Refund%20Requests/Refund%20Processing.aspx)
- [Form design page](https://forms.cloud.microsoft/Pages/DesignPageV2.aspx?origin=NeoPortalPage&subpage=design&id=LzX5fevFB0CnI0TAeGBcemFBFqB54EFOo3V5rhDHnAJUOUVaT1hEUFlESUtaV0dMQzlBSUNaRVRaVS4u&analysis=false)

Current connections use the flow owner's work account. IT should confirm the actual
Forms, SharePoint, and Teams connection references in the designer, their owners, and
their permissions. Do not assume adding a co-owner transfers connection credentials.

The Teams destination is the existing meeting chat supplied by the business owner.
The business owner explicitly approved everyone with access to that chat receiving alerts.
Its conversation ID is stored in the flow, not reproduced here. No new private channel
was created. Changes to meeting-chat membership affect the alert audience.

## 4. Architecture: implemented versus planned

```text
PRODUCTION BUILT AND OFF; ISOLATED COPY PARTIALLY RUNTIME-VALIDATED

Microsoft Forms: new response
  -> Get response details
  -> SharePoint: find by Submission Key
  -> Condition: no existing matching item?
       Yes -> Create item with Submitted / Pending statuses
       No  -> No change to existing item
  -> On failure / timeout / upstream skip:
       Teams operational alert -> Terminate with Failed status

PLANNED, NOT IMPLEMENTED

EnQuote native form
  -> Approved authenticated submission service
  -> SharePoint List with stable idempotency key

Authorized processing changes in SharePoint
  -> Approved version-aware synchronization
  -> Shared EnQuote refund queue
```

The Forms intake path uses Microsoft cloud connectors and should not require an open
desktop once activated. That does not apply to the retained legacy Excel workflow.
The future EnQuote path involves its application backend and needs a separate IT review
of hosting, authentication, customer-data boundaries, and operational ownership.

## 5. How the Forms flow works

### Intake and duplicate protection

1. **When a new response is submitted** selects the designated Form.
2. **Get response details** uses the actual trigger Response Id dynamic-content token.
3. **Get items** reads the new SharePoint List using the unique Submission Key:

   ```text
   forms:<Form ID>:<Response ID>
   ```

   The OData field is `Submission_x0020_Key`; Top Count is 1.
4. **Condition** compares:

   ```text
   length(body('Get_items')?['value'])
   ```

   with the numeric expression:

   ```text
   int('0')
   ```

5. The True branch creates the item. The False branch does nothing.
   A duplicate replay must not reset a processed item's status, notes, or approvals.
6. Trigger concurrency is limited to 1. The SharePoint key is required, indexed, and
   unique as a second line of protection against duplicates.

A response ID alone is not globally unique across Forms. Keep the Form ID in the key.
Do not generate a new key during retries of the same source request.

### Field mappings

| Source | Destination / behavior |
|---|---|
| Form response ID | Forms Response ID; also part of Submission Key |
| Form ID | Source Form ID |
| Fixed source | Submission Source = Microsoft Forms |
| Submission time | Submitted At |
| Responders' Email | Requester Email |
| Case number | Case Number and Title |
| Cancellation timing | Cancellation Timing |
| Refund choice | Refund Choice |
| Refund amount requested | Refund Amount (USD); blank maps to null, otherwise `float(...)` |
| Services completed | Services Completed |
| Customer escalated | Customer Escalated |
| Site / subscription IDs | Site ID / Subscription ID |
| Customer name / email | Customer Name / Customer Email |
| Primary reason | Primary Reason |
| Other reason | Other Reason |
| Detailed explanation | Detailed Explanation |
| Initial workflow values | Request Status = Submitted; Manager Approved = Pending |
| Initial integration value | Integration Status = Pending |

The connector does not supply requester name or department in the inspected schema.
Those fields remain unset rather than being fabricated. Confirm responder identity
behavior under the actual Form access settings during testing.

`Pending` integration status is intentional: successful Forms intake is not evidence
that EnQuote has received the record. No EnQuote synchronization currently exists.

### Amount validation

- Native EnQuote code requires a finite, nonnegative amount with at most two decimal
  places for refund requests, up to USD 1,000,000,000. Zero is valid.
- Native No refund submissions discard stale amount and services-completed values.
- The cloud flow currently converts supplied Form amounts with `float`; it does not
  independently implement all native amount/branching validation.
- The isolated Form accepted `-1.001`, but the SharePoint connector rejected Create item
  because the amount must be at least zero. The run failed, sent its labeled alert, and
  created no item. This verifies the lower bound, not fractional-cent or upper-bound rules.
- Test the actual Form's restrictions. Invalid, stale conditional, negative, over-limit,
  or fractional-cent values must not silently become accepted business data.
  If the Form permits such input, add explicit flow-side validation before activation.
  Do not change the existing Form questions without approval.

### SharePoint schema cautions

The 39 added fields cover source identity, requester/customer details, cancellation/refund
answers, processing/approvals, and integration health. List statuses are:

```text
Submitted, Under Review, Approved, Denied, Completed, Cancelled
```

Manager approval choices are Pending / Yes / No / Not required.
Integration choices are Pending / Synced / Error.

SharePoint generated internal names from display names. Examples:

```text
Submission Key -> Submission_x0020_Key
Request Status -> Request_x0020_Status
```

Do not assume XML StaticName equals InternalName. Inspect the list's field metadata or
use connector field selectors. Do not create duplicate columns to work around a mapping error.

## 6. Failure handling and monitoring

**Notify refund intake failure** uses the owner's Teams connection and posts as **User**
to the configured chat. Its Run after conditions on Condition are:

- Has failed
- Has timed out
- Is skipped

Skipped is included to catch failures in upstream response retrieval or list lookup.
Successful intake and duplicate no-ops must not send failure notifications.

The alert contains a fixed operational summary and a URL for that flow run, generated
from `workflow()`. It contains no customer answers or raw connector error payloads.
Recipients still need Power Automate permissions to inspect the run.

A following **Terminate** action sets status Failed after a successful alert, with code
`RefundIntakeFailed`. This prevents notification delivery from masking intake failure.
If the Teams action itself fails, the run must still be treated as failed and investigated.

Teams alerts cannot cover every failure mode: a disabled flow, missing trigger event,
expired trigger connection, or broken Teams connection may produce no chat notification.
Support must independently check flow state, connection health, failed runs, and expected
response-to-item counts. IT should assign a monitoring cadence and escalation owner.

Meeting chats can have lifecycle/access restrictions. Delivery was proved from the isolated
test flow; that does not guarantee future access or production connection health.
If delivery fails, obtain approval for an alternate destination; do not silently broaden
the audience or fall back to a standard/public channel.

## 7. What can be tested now?

### Safe local tests: available now, no tenant writes

The focused native/UI/backend suites previously passed 35 tests. The tab-restoration
change also passed its 5-test UI suite and targeted lint. These are local regression tests,
not proof that Power Automate can access the tenant resources.

From the repository root:

```powershell
node --test electron\refundSubmission.test.cjs tests\refundRequestsUi.test.mjs tests\refundNativeAnswers.test.cjs enquote-sync-worker\test\refund-requests.test.js tests\refundFormVite.test.mjs tests\electron\refundFormWindow.test.cjs tests\refundRequestData.test.mjs
```

Coverage includes validation, zero amounts, conditional fields, persisted submissions,
duplicate handling in the retained native path, queue behavior, and Vite schema loading.
Some tests exercise the legacy Excel service; passing them does not implement SharePoint.

### Cloud tests: isolated session completed; further acceptance required

The Forms-to-List flow and Teams action can be tested before EnQuote integration exists.
Full EnQuote-to-SharePoint-to-EnQuote testing cannot pass until that integration is built.
The business owner approved the isolated session recorded in section 12. The following
procedure and matrix apply to further testing; they do not authorize production activation.

**Do not simply remove `@false` and turn the production flow on.** This could process real
submissions. A manual Test session does not necessarily prevent other trigger events.

Preferred test setup:

1. Obtain approval to create a separate test Form, test List, and test flow.
2. Copy the schema into a test List, retaining unique-key enforcement and version history.
3. Use a separate test Form with the same answer types/choices/branching. Copies may have
   different question IDs; inspect and remap all dynamic-content tokens.
4. Use a test copy of the flow with its own trigger and connections, targeting only the
   test Form and test List. Keep the production flow Off and guarded throughout.
5. Mark all test records clearly, for example `TEST-CARE-20261016-001`.
   Use `example.com` addresses and obviously synthetic names/site/subscription IDs.
6. Route test alerts to an approved destination. Before using the business meeting chat,
   approve a clearly labeled operational test message; do not post customer information.
7. Enable only the isolated test flow for a defined test window. Record its resource IDs,
   tester, date, run URLs, and expected results in the IT change record.
8. Turn the test flow off when finished. Retain test evidence; do not delete anything
   automatically. Cleanup is a separate approved action.

If a separate Form cannot be created, a manually triggered test copy can accept an
explicit synthetic response ID and exercise retrieval/mapping/list writes. This validates
the processing path only, not the real Forms trigger. A separate trigger test is still required.

### Test matrix and acceptance criteria

| Test | Expected result |
|---|---|
| Partial refund, 129.95, Other reason | Exactly one item; amount 129.95; all applicable answers and source metadata mapped |
| Full refund, zero | Zero retained, not blank/null |
| No refund | Cancellation details retained; amount/services absent rather than stale or invented |
| Other vs a standard reason | Other explanation only when applicable; detailed explanation retained |
| Missing/invalid amount | Rejected by Form or explicit flow validation; never accepted silently |
| Negative, 3-decimal, excessive amount | Enforced business validation; add cloud validation if current Form permits them |
| Replay the same response/run | Still one item; same key; no reset of status, notes, approvals, or customer data |
| Two different responses submitted close together | Two unique items; no lost response; sequential runs |
| Retry after simulated temporary failure | One eventual item or an explicit actionable failure; no duplicate |
| Missing/unauthorized SharePoint destination | Failed run; operational alert; no success-shaped fallback |
| Upstream response retrieval failure | Downstream Condition skipped; failure alert attempted |
| Teams delivery failure | Failed run visible independently in history; no false success |
| Successful intake and duplicate no-op | No failure alert |
| Production protections after test | Original flow Off; `@false` present; no production test records |

For fault tests, use only the isolated flow. Point a copied action at a nonexistent test
resource or use a controlled failing test action. Do not revoke live permissions, alter
production records, or break shared connections to manufacture a failure.

For replay, use Resubmit on the isolated flow run where supported and verify the same
source ID is used. If unavailable, use a manual test harness with the same response ID.
Submitting the Form again generates a new response and does not test duplicate replay.

Pass criteria require inspecting saved item values and item counts, not merely green
action cards. Record both run-history evidence and SharePoint item/version evidence.

## 8. Troubleshooting and repair

| Symptom | Likely cause / checks | Safe corrective action |
|---|---|---|
| No runs at all | Flow Off, `@false`, wrong Form, trigger connection/access | In production these guards are intentional. Validate in isolated flow; do not remove guards without approval |
| Get response details fails | Wrong Form/response pairing, invalid token, expired Forms connection | Reauthenticate approved connection; verify actual Response Id token and matching Form |
| Get items returns 400 | Wrong internal field name, malformed OData quotes, or designer lost recent edits | Use `Submission_x0020_Key`; prefer one expression for the quoted key; save, reload, and inspect persisted configuration |
| Get items/Create item returns 401/403 | Connection owner lost access, policy block, expired connection | Capture error/run ID; have IT repair least-privilege access/connection; do not widen site permissions |
| List missing or fields unavailable | Wrong site/list selector, copied resource IDs, stale schema | Reselect approved list and verify metadata; preserve existing fields/records |
| Numeric conversion fails | Non-numeric amount or unsuitable locale/input | Inspect redacted test value and Form rules; add explicit validation, not a zero default |
| Amount is null despite a supplied answer | Missing mapping after switching actions or changing List Name | Expose advanced parameters, restore amount expression, keep action selected while saving, then verify with a new synthetic response |
| Create item rejects negative amount | Connector enforces the List's zero minimum | Correct the source/business input; do not retry unchanged or substitute zero |
| Choice value rejected | Form/List choices differ | Compare exact labels and connector choices; agree mapping with process owner |
| Item exists but EnQuote shows nothing | SharePoint-to-EnQuote sync is not implemented | Expected current limitation; do not turn on legacy Excel mirroring as a fix |
| Duplicate-key conflict | A prior attempt may already have committed | Look up the same key and inspect item contents; replay must no-op; never generate a replacement key |
| Duplicate items with different keys | Key construction changed or wrong Form ID used | Pause intake; investigate source IDs; preserve evidence; approved reconciliation only |
| Status/notes reset on replay | Intake accidentally updating an existing record | Pause flow; remove replay-update behavior in a test copy; recover approved values from version history |
| Teams alert missing | Chat access/lifecycle, Teams connection, connector policy, trigger never ran | Inspect flow state and notification action; validate approved chat and user connection |
| Run succeeded after intake error | Failure was swallowed or termination misconfigured | Verify Run after flags and Failed Terminate; retest failure cases |
| Only Active Subscriptions visible | Installed UI predates restored tabs | Publish approved UI release; reload/restart normally; do not toggle integration flag to restore navigation |
| Tabs open Microsoft pages rather than a native queue | Intended browser-only mode | Use work-account permissions; finish approved native integration before enabling it |
| Form submission absent from new List | Production Forms intake is Off or a run failed | Current browser UI warns about this; inspect flow state/history and source response before any approved replay |
| Legacy Excel pending/error | Old native workbook path still in use | Keep legacy route disabled for the new rollout; preserve pending IDs/data and escalate |

### Standard incident procedure

1. Capture the flow name, run ID/URL, failed action, UTC time, status code, and connector
   error category. Keep customer payloads out of broad-access tickets/chat.
2. For possible data corruption, duplicate creation, or unintended processing, turn the
   affected flow Off. Review in-progress runs separately; turning Off does not roll back
   an already committed item or guarantee an in-progress run has stopped.
3. Check the destination by the exact Submission Key before retrying.
4. Diagnose in an isolated copy. Repair connection or mapping through an approved change.
5. Replay only the affected response, with its original key, after verifying idempotency.
6. Compare item values, versions, counts, and source responses; document the result.
7. Resume only under change approval. Do not bulk-resubmit all runs without reconciliation.

SharePoint version history can help recover unintended field changes. Restoration is a
data modification and requires approval; never delete/recreate the list as a repair.

## 9. Security, ownership, and IT decisions required

IT should confirm:

- Approved data classification and retention for customer names/emails, case/site IDs,
  request narratives, run history, and audit records.
- Least-privilege Forms/List/Teams permissions; membership visibility of the processing
  list and alert chat. No permission changes were made during preparation.
- Power Platform DLP/connector policy, licensing, environment placement, and whether
  deployment belongs in a managed solution with connection references/environment variables.
- Operational owner, backup/co-owner, incident escalation, monitoring cadence, and
  connection repair/rotation procedures. Ownership changes do not transfer connections.
- Whether to replace owner-bound connections with an approved supported service identity.
- The future authentication design for EnQuote; never embed cloud credentials in renderer
  code or use a secretless public HTTP endpoint.
- Any required review of the EnQuote Worker/Cloudflare D1 data boundary before syncing
  customer information outside Microsoft 365.
- Authorized roles for submission, processing, approvals, exports, and reconciliation.
- A version-aware write contract so an older EnQuote client cannot overwrite newer
  processor edits. Define field ownership and conflict resolution before implementation.
- A business-approved rule for cancellation-only requests and missing approval/department
  fields; do not silently invent required values.

The existing legacy Worker `/ingest` endpoint has a different validation contract and is
not a drop-in target for this Form. Do not wire Forms directly to it or bypass role checks.
Existing backend endpoints and the desktop flag are not a substitute for backend access
controls; their current deployed configuration requires the normal IT review.

### IT setup instructions: proposed direct Microsoft Graph desktop integration

This is a proposed setup, not an implemented EnQuote capability or approval to change
tenant permissions. SharePoint access for a person and API authorization for an application
are separate. Users retain their own access; EnQuote must also be registered and consented.
Depending on tenant policy, a user may be able to register an app, but that does not
necessarily permit granting consent or resource access. Do not bypass tenant restrictions.

**Requested architecture:** single-tenant desktop public client, system-browser sign-in
using authorization code with PKCE, delegated Microsoft Graph access, and no client secret.
Refund requests would be read/written directly to the approved SharePoint List rather
than copied through the existing Worker/D1 refund route. Implementation and a data-flow
review are still required; do not assume the current application already follows this design.

#### A. Register the desktop application

1. An authorized administrator/app owner opens [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Navigate to **Entra ID -> App registrations -> New registration**.
3. Name: **EnQuote - Care Refund Tracker**.
4. Supported account types: **Accounts in this organizational directory only**.
5. Register, then record **Application (client) ID** and **Directory (tenant) ID**.
   Do not confuse the client ID with the app registration Object ID.
6. Under **Authentication -> Add a platform -> Mobile and desktop applications**,
   configure `http://localhost` for the proposed system-browser loopback flow.
   The developer must use the matching supported MSAL redirect configuration.
7. Do not create a client secret or enable implicit token grants. Do not enable password
   or device-code flows merely to work around a blocked interactive sign-in.
   The proposed authorization-code/PKCE implementation does not require enabling
   additional public-client grant types.
8. Assign an application owner and backup. Apply approved Conditional Access/MFA policies;
   do not exempt the application to make a test pass.

#### B. Approve least-privilege access

1. Under **API permissions -> Add a permission -> Microsoft Graph -> Delegated permissions**,
   request **Lists.SelectedOperations.Selected**. An authorized administrator grants consent.
   Do not substitute application/app-only permissions for this desktop design.
2. Consent alone grants no List access. An authorized SharePoint/Graph administrator must
   also grant this client application the **write** role on the approved refund List.
   Delegated runtime access remains limited by the signed-in user's permissions as well.
3. **Permission-change approval is required first:** Microsoft's selected-permissions
   guidance warns that list-level assignments break inheritance on the assigned resource.
   This differs from the earlier additions-only/no-permission-changes scope. IT must
   review the effect, capture existing access, and verify user access is preserved.
   Do not execute the grant under the earlier isolated-test authorization.
4. If list-level assignment is unsuitable, IT may evaluate delegated **Sites.Selected**
   with a site-level write grant instead. That has a wider resource boundary but does not
   break inheritance at the site-collection root. It is a separate approval decision,
   not an automatic fallback. Do not default to tenant-wide `Sites.ReadWrite.All`.
5. Use an approved administrative tool/identity for provisioning the resource grant.
   That tool may require broader privileges; **do not add those provisioning privileges
   to the EnQuote runtime app**. Retain the created permission ID for revocation.

Example administrator-only list grant, after approval:

```http
POST https://graph.microsoft.com/v1.0/sites/{graph-site-id}/lists/{approved-list-id}/permissions
Content-Type: application/json

{
  "grantedToV2": {
    "application": {
      "id": "<EnQuote application CLIENT ID>",
      "displayName": "EnQuote - Care Refund Tracker"
    }
  },
  "roles": ["write"]
}
```

The Graph site ID is not the List ID or Power Platform environment ID. IT can resolve it
with an appropriately authorized administrative tool:

```http
GET https://graph.microsoft.com/v1.0/sites/enphase.sharepoint.com:/sites/CustomerFinancingandOMMarketplace?$select=id,webUrl
```

Start acceptance with the isolated test List
`78a54169-e1dc-4be5-8773-e90e0b78996d`. Production List
`a3632928-dfa6-4e85-91b8-8d2de6ddc996` requires a separate approved grant and rollout.
Do not change list membership, enable flows, or grant production write access implicitly
as part of setting up the test application.

#### C. Return these non-secret configuration details

- Directory (tenant) ID and application (client) ID.
- Approved redirect URI and delegated scope.
- Graph site ID and approved List ID(s).
- Confirmation of consent/resource grants, grant IDs, and scope of approval.
- Owner/backup, permitted pilot users, and Conditional Access requirements.

Do not send passwords, access/refresh tokens, client secrets, or signed trigger URLs.
The tenant/client/resource IDs above are configuration, not credentials.

#### D. Developer implementation and joint acceptance

The developer must add Microsoft sign-in, protected token caching outside the renderer,
tenant/account validation, explicit sign-out/error handling, and scoped List access.
The current EnQuote login must not be treated as proof of Microsoft Graph authorization.
Implement paging/refresh, durable idempotent submissions, version-checked updates, and
business validation. Never forward Graph tokens or new refund payloads to the legacy
Worker route as a shortcut.

Test two authorized users against synthetic records, blocked/unapproved access, MFA,
sign-out/account changes, network loss, retries, duplicate submissions, and conflicting
edits. Verify no access outside approved resources. Define processor/approver authorization
separately: delegated write access is not a field-level approval policy.
Only after acceptance should a matching EnQuote release and separately approved production
grant/flow activation occur. App registration alone does not make synchronization work.

Microsoft references:

- [Configure desktop apps that call web APIs](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)
- [Selected permissions, consent, resource grants, and inheritance](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [Create permission on a List](https://learn.microsoft.com/en-us/graph/api/list-post-permissions?view=graph-rest-1.0)

## 10. Release and activation checklist

### Forms-only pilot

- [ ] IT/business approve the isolated tests and pilot scope.
- [ ] Synthetic mapping, amount/branching, duplicate, retry, and failure tests pass.
- [ ] Teams delivery is verified to the approved audience.
- [ ] Support owner/backup and monitoring/escalation are assigned.
- [ ] List permissions, connection ownership, retention, and DLP reviewed.
- [ ] Export an approved flow backup/configuration record without exposing secrets.
- [ ] Define pilot start time and which new responses will be processed.
- [ ] Confirm historical/backlog responses will not be bulk-imported automatically.
- [ ] Remove production `@false` only under an approved change, then turn the flow On.
- [ ] Observe an approved synthetic/pilot response and compare saved values/counts.
- [ ] Monitor closely and retain a documented rollback path.

A Forms-only pilot can precede EnQuote integration if approved. It must be described as
Forms-to-SharePoint tracking only, not as a working EnQuote shared refund queue.

### Full EnQuote rollout

- [ ] Implement authenticated native-to-list submission with durable retries/idempotency.
- [ ] Implement authorized, version-aware list-to-EnQuote synchronization.
- [ ] Remove competing Excel authority from the approved active path.
- [ ] Test lost responses, offline clients, conflicting updates, stale clients, and recovery.
- [ ] Deploy matching Worker/desktop/shared-schema versions through the release process.
- [ ] Publish restored tabs without accidentally enabling unfinished operational services.
- [ ] Enable native refund features only after the new route is verified and approved.
- [ ] Verify on a representative installed desktop, not just local unit tests.

### Rollback / stop-processing

1. Turn the new Forms flow Off and reinstate `@false` before further editing.
2. Inspect in-progress runs and already created items; do not assume automatic rollback.
3. Keep native operations disabled until a known-good coordinated release is available.
4. Preserve SharePoint items, source responses, audit/version history, and pending IDs.
5. Do not re-enable Excel mirroring or bulk-write old snapshots into the list.
6. Reconcile and replay only under an approved recovery plan.

## 11. Developer support references

These relative links apply inside the source repository. If copying this document into an
IT folder, provide the repository location separately; the operational Microsoft links
above remain usable subject to access permissions.

- [Enphase Care page and tab gating](../src/pages/EnphaseCare.jsx)
- [Native refund form](../src/components/enphaseCare/RefundRequestForm.jsx)
- [Shared question schema and validation](../shared/refundForm.cjs)
- [Disabled feature flag](../shared/refundFeature.json)
- [Desktop operation gating](../electron/collabFeatures.cjs)
- [Retained native submission/retry service](../electron/refundSubmission.cjs)
- [Worker request validation and handlers](../enquote-sync-worker/src/refund-requests.js)
- [Preparation notes and legacy architecture](refund-tracker-power-automate.md)
- [Retained native/Excel behavior](refund-request-power-automate.md)

Do not interpret the older workbook instructions as authorization to install that route.
This runbook distinguishes the prepared list design from retained legacy code.

### Evidence record template

For each approved test or incident, record:

```text
Change/ticket ID:
Tester and approver:
Date/time (UTC):
Test flow/Form/List identifiers:
Synthetic case marker:
Source response ID and submission key:
Run-history URL:
Expected item count and values:
Actual item count and values:
Duplicate replay result:
Failure/notification result:
Production flow Off / guard verified:
Outstanding defects and next owner:
```

## 12. Authorized isolated validation session: October 16, 2026

After reviewing the proposed scope, the business owner approved preparation and execution
of an isolated cloud test using synthetic data and a clearly labeled alert in the
approved meeting chat. Production activation was not approved.

Created test resources:

| Resource | Identifier / scope |
|---|---|
| Test List | Care Refund Requests TEST 20261016 |
| Test List ID | `78a54169-e1dc-4be5-8773-e90e0b78996d` |
| Test flow | Care Refund Requests - ISOLATED TEST 20261016 |
| Test flow ID | `5d586e73-da00-4e77-bd28-e2feea2c9c1b` |
| Test Form | Enphase Care Cancel/Refund Request Tracking (Copy) (2) |
| Test Form ID | `LzX5fevFB0CnI0TAeGBcemFBFqB54EFOo3V5rhDHnAJUM1kzV0FLSzZDMFI5M1VVTEoyUlZVRFJIMi4u` |

The test List has 39 cloned custom fields, versioning enabled, no navigation entry, and
no permission changes. The test flow was copied in the Off state, then retargeted to
the test Form and List before enabling it for the approved test window.

Initial synthetic case: `TEST-CARE-20261016-001`, partial refund USD 129.95, Other reason.
The existing Form and production list were not used for this submission.

Initial run `08584094276580508359892786886CU26`:

- Forms trigger and Get response details succeeded.
- Get items failed because the saved test-copy OData filter had lost the response token
  and trailing quote. No list item was created by that attempt.
- The failure-notification action returned HTTP **201**, with a created Teams message.
  The message was labeled **ISOLATED SYNTHETIC TEST**, contained no customer data, and
  linked to the failed test run.
- The test query was replaced with an atomic expression that concatenates the field,
  quoted namespaced test key, and actual trigger response ID. Replaying that response
  succeeded at lookup/create in run `08584094275443512260792934836CU28`, but inspection
  found the amount mapping was absent: item 1 had null instead of 129.95. This is a
  **failed mapping test**, not a successful refund-amount test.

This demonstrates why designer validation alone is insufficient. Production mappings
still require their own controlled acceptance check before activation.

### Corrections made only in the isolated flow

The designer lost recent rich-input edits when switching actions too quickly. Changing
Create item's List Name also cleared mappings. Rebuild mappings using the connector's
tokens/expressions, save with the action still selected, wait for save confirmation, and
inspect persisted configuration and actual item values.

The corrected Get items filter is a single expression, with Top Count 1:

```text
concat('Submission_x0020_Key eq ', decodeUriComponent('%27'), 'forms:LzX5fevFB0CnI0TAeGBcemFBFqB54EFOo3V5rhDHnAJUM1kzV0FLSzZDMFI5M1VVTEoyUlZVRFJIMi4u:', string(triggerOutputs()?['body/resourceData/responseId']), decodeUriComponent('%27'))
```

The corrected Refund Amount (USD) mapping is:

```text
if(empty(outputs('Get_response_details')?['body/rdbae05b6f26b490c9f8a13f3da539f66']), null, float(outputs('Get_response_details')?['body/rdbae05b6f26b490c9f8a13f3da539f66']))
```

These are **test-copy expressions**, not instructions to paste the test Form ID into
production. Production must use its own Form ID, verified question IDs, and approved
change process. Its existing query/mappings were not modified during this session.
The test List also required Title; Title was mapped to the synthetic case number.

### Observed results

| Test / synthetic case | Run ID | Observed result |
|---|---|---|
| Partial refund, `TEST-CARE-20261016-002` | `08584094274274817731014780093CU14` | Succeeded; item 2 stores numeric 129.95, Partial refund, and source response 2 |
| Full refund, `TEST-CARE-20261016-003` | `08584094273958317458773077679CU10` | Succeeded; item 3 stores numeric zero, Full refund, and services Yes |
| Cancellation only, `TEST-CARE-20261016-004` | `08584094273858003198149255642CU02` | Succeeded; item 4 stores No refund, null amount, null services |
| Replay source response 2 | `08584094272894614858496983424CU26` | Succeeded; no duplicate and no processing edits overwritten |
| Invalid amount `-1.001`, `TEST-CARE-20261016-005` | `08584094272565208883928358792CU20` | Form accepted response; Create item rejected amount below zero; no item 5; notification and Terminate succeeded; overall run Failed |

For the replay test, only test item 2 was deliberately updated to **Under Review** with
the note `TEST replay must preserve this processor note.` before resubmitting the same
run. After replay, that item's key, amount, status, note, Modified timestamp
`2026-10-16T19:38:46Z`, and version **2.0** were unchanged. The test List still contained
exactly four items, not five. Submitting another Form response was not used as a proxy
for duplicate replay. The replay's run view explicitly showed both the failure-notification
action and Terminate as **Skipped**, so the duplicate no-op did not send a failure alert.

Test item 1 remains an intentionally retained failure artifact with null amount. It was
not overwritten or deleted to make the mapping test appear to pass. Response 5 remains
in the copied Form/run history but has no List item because its invalid amount was rejected.

The failed negative-amount run showed that successful Teams delivery does not hide the
failure: Notify refund intake failure succeeded, Terminate executed, and the overall
run remained Failed. Both test alerts were labeled synthetic and contained only a fixed
operational summary and a run link.

### Verified shutdown and retained evidence

- The isolated test flow was turned **Off** after testing; its details page confirmed Off.
  All seven recorded runs were terminal: five Succeeded and two Failed, with none running.
- The production flow's details page was rechecked: **Off**, no run history, and unchanged
  modification time. Its existing `@false` guard was not edited during testing.
- A read of the production List returned **zero items**. No test records were written there.
- The test List retained exactly four items and their versions; no test artifacts were deleted.
- The native feature flag remains disabled. No desktop/Worker release, production
  activation, workbook modification, or permission change was performed.

### Remaining acceptance work / stop conditions

- Independently test positive fractional cents, the maximum amount and values above it,
  missing/non-numeric amounts, stale conditional answers after changing refund choice,
  and stale Other explanations after changing reason. The negative test does not prove
  these independent rules. Add explicit cloud validation/normalization where needed;
  do not rely on display rounding or on native validation for Forms submissions.
- Exercise upstream retrieval failure, Teams connection failure, and controlled transient
  retries. Never break a live shared connection or revoke live permissions for testing.
- Promote the approved query/amount fixes to production only under a separate change,
  verify all persisted mappings, reopen Flow checker, and resolve the potential-problem
  advisory displayed on production details. An earlier clean checker result is not
  current acceptance evidence.
- Complete the IT ownership, permissions, retention, licensing/DLP, and pilot checks.
- Build and validate native-to-SharePoint submission and shared queue synchronization
  before presenting the full EnQuote workflow as operational.

**Bottom line:** Production is not activated. Full shared EnQuote processing remains
development work. The isolated tests establish partial cloud readiness, not complete
production acceptance.

## 13. Browser access and post-approval code preparation

The business owner requested browser-based SharePoint access now, with as much safe
native integration preparation as possible before IT approval. No permission changes,
new Microsoft sign-in, production flow activation, deployment, or test-data deletion
was performed for this code preparation.

### Browser mode: implemented locally

- **Enphase Care -> Submit Request** opens the original production Form's response page,
  not its designer and not the synthetic copied Form.
- **Enphase Care -> Refund Requests** opens the production List's Refund Processing view.
  Both tabs provide the other destination as a secondary link.
- Links open externally in the desktop's system browser (or a new tab in browser preview).
  The user signs into Microsoft directly; EnQuote does not collect Microsoft credentials.
- Microsoft controls access to these pages. Existing EnQuote page-role checks remain.
- Both tabs explicitly warn that Forms-to-List automation is not activated. A Form
  response is not proof that the new List received it. Existing workbook behavior is
  unchanged, and browser links do not import or migrate any records.
- There is no automatic EnQuote queue refresh in this mode. Users refresh the Microsoft
  page to see other processors' changes.

No production Form was submitted as part of validating these links.
Before publishing browser access for routine use, the process owner must acknowledge
the intake-off gap or approve completion/activation of the tested Forms flow separately.
Do not misrepresent browser access as a fully launched refund workflow.

### Non-secret configuration handoff

[shared/refundSharePoint.json](../shared/refundSharePoint.json) centralizes the browser URLs
and proposed native settings. Its `native` object contains:

| Setting | Prepared value / action |
|---|---|
| `tenantId` | Empty: IT supplies the approved tenant GUID |
| `clientId` | Empty: IT supplies the desktop application's client GUID |
| `graphSiteId` | Empty: IT supplies the Graph composite site ID |
| `testListId` | Isolated List ID already recorded |
| `productionListId` | Production List ID already recorded; not authorization to access it |
| `redirectUri` | `http://localhost`; must match approved MSAL/system-browser setup |
| `scopes` | Delegated `https://graph.microsoft.com/Lists.SelectedOperations.Selected` only |
| `refreshIntervalMs` | 15000, a proposed future queue-refresh interval, not an active timer |

The browser `formsIntakeEnabled` value is false. It controls the warning only, not the
cloud flow. Change it only after approved activation and verified production intake;
do not hide the warning merely to make the page appear live.

These settings may ship with the application and must never contain secrets or tokens.
Configuration validation is not permission verification or IT approval. Filling the
three empty identifiers does **not** activate native sync.

### Dormant native transport: implemented and locally tested

[electron/refundSharePoint.cjs](../electron/refundSharePoint.cjs) is a main-process module
that is **not imported by the running application and has no IPC handlers**.
It accepts an injected token-acquisition function for the future Microsoft authentication
implementation. No token is acquired, no Graph call is made, and no polling starts simply
by installing the current code.

Prepared behavior:

- Reject incomplete tenant/client/site configuration and default to the isolated test List.
- Read paginated Graph List items, preserving raw fields and eTags for future UI mapping.
- Restrict requests/pagination to the configured List and reject HTTP redirects so tokens
  are not forwarded to unrelated destinations.
- Discover actual internal column names through List metadata rather than guessing
  SharePoint's truncated field names.
- Validate native answers using the shared form schema; retain zero, reject invalid
  amounts, and discard stale No refund/Other answers.
- Create using a caller-supplied durable UUID (`enquote:<UUID>`). Look up that key first,
  leave existing items unchanged, and reconcile a concurrent HTTP 409 only against that key.
  The List's unique-key constraint remains essential. Other errors propagate explicitly.
- Permit only explicit status/store-team-note/escalation-note patches with the item's
  last-read eTag in `If-Match`; surface HTTP 412 instead of silently overwriting newer edits.
- Surface sign-in/permission errors, throttling with Retry-After metadata, timeouts,
  malformed responses, and incomplete pagination. Never automatically retry writes or
  return a fake empty queue after a failed read.

The module is **not a complete service or authorization boundary**. It must not be exposed
directly to the renderer. A trusted caller must derive requester identity from verified
Microsoft authentication, enforce EnQuote processor/approval policy, persist the UUID
and original timestamp before attempting submission, and retain it after ambiguous failures.
Approval-field writes are intentionally absent pending the approval policy.
The returned raw fields are not yet the existing refund queue's data model.

Graph/column compatibility and real resource grants remain to be verified in the tenant
after approval. Offline mock tests prove the client contract, not tenant acceptance.

### Post-approval implementation sequence

1. Obtain the approved configuration and isolated List grant using section 9.
2. Implement system-browser MSAL/PKCE sign-in, tenant/account checks, OS-protected token
   caching in the main process, sign-out, and account-change cleanup.
3. Connect the transport behind authenticated/role-checked IPC. Do not accept requester
   identity or arbitrary Graph URLs from renderer payloads.
4. Add durable submission state/recovery, map List fields into a native SharePoint queue,
   expose item versions/conflicts, and implement visible/active-only refresh using the
   configured interval. Do not reuse legacy workbook-sync authority.
5. Run the two-user, network/restart/conflict, least-privilege, and Forms acceptance tests
   against isolated resources. Verify all choices and required column metadata.
6. Approve production configuration/grants, complete Forms validation, then publish the
   coordinated native release and activate under a monitored pilot.

Do not flip [shared/refundFeature.json](../shared/refundFeature.json) to enable this new
transport: that flag still mounts the retained Excel-backed service. A separate native
provider integration and approval gate are required before changing that behavior.

### Local verification

The combined focused suite passed **48 tests**, including 12 new Graph transport tests.
The Vite production build, project typecheck, and targeted UI/transport lint passed.
Browser preview verified both refund tabs, their deep links, production destination URLs,
and the intake-off warning. No Form was submitted and no SharePoint data was changed.
No new dependencies were installed. Desktop system-browser launch uses the existing
external-link handler; installed-desktop acceptance remains part of release verification.

```powershell
node --test electron\refundSharePoint.test.cjs electron\refundSubmission.test.cjs tests\refundRequestsUi.test.mjs tests\refundNativeAnswers.test.cjs enquote-sync-worker\test\refund-requests.test.js tests\refundFormVite.test.mjs tests\electron\refundFormWindow.test.cjs tests\refundRequestData.test.mjs
```
