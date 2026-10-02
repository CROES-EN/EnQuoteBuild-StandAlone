# EnQuote Real-Time Sync Architecture & Salesforce Migration Plan

## Executive Summary

EnQuote's quote synchronization layer runs entirely on Cloudflare's global edge network — a serverless, zero-infrastructure architecture that delivers **sub-second real-time updates** to all 20 desktop users while maintaining enterprise-grade security. This document outlines the current architecture and the path to replacing Base44 with Salesforce as the backend data source, requiring **zero changes to the desktop application**.

---

## Current Architecture

### How It Works

EnQuote uses a Cloudflare Worker as a secure middleware layer between the desktop application and Base44. The Worker handles all data synchronization, caching, and real-time push notifications.

```
┌─────────────┐          ┌──────────────────────────────────┐          ┌──────────┐
│  20 Desktop  │          │     Cloudflare Edge Network      │          │  Base44  │
│  Apps (Elec) │◄────────►│                                  │◄────────►│  (API)   │
│             │  WebSocket│  ┌──────────┐  ┌──────┐  ┌─────┐ │  HTTPS   │          │
│             │   + HTTP  │  │  Worker  │  │  KV  │  │ D1  │ │          │
└─────────────┘          │  │  (sync)  │  │(cache)│  │(DB) │ │          │
                         │  └────┬─────┘  └──────┘  └─────┘ │          │
                         │       │                            │          │
                         │  ┌────▼─────┐                      │          │
                         │  │ Durable  │  WebSocket Hibernation│          │
                         │  │ Object   │  (zero cost at idle) │          │
                         │  └──────────┘                      │          │
                         └──────────────────────────────────┘          └──────────┘
```

### Data Flow

**Inbound (Base44 → all desktop apps):**
1. Base44 sends a snapshot to the Worker via signed, encrypted webhook
2. Worker verifies HMAC-SHA256 signature and decrypts AES-256-GCM payload
3. Data is stored in D1 (SQLite database) with idempotent deduplication
4. Worker proactively refreshes the KV cache (all 20 apps read from cache — zero database cost)
5. Durable Object pushes a `quotes_updated` notification to all connected apps via WebSocket
6. All 20 apps receive the update in **under 1 second**

**Outbound (desktop app → Base44):**
1. Desktop app POSTs changes to the Worker
2. Worker pushes to Base44 via authenticated API call
3. Worker pushes an `outbound_status` confirmation back to the app via WebSocket — **no polling required**
4. If the push fails, a Cloudflare Queue handles automatic retry with exponential backoff (up to 5 retries)
5. The app receives the retry result over WebSocket when it completes

### Performance Achieved

| Metric | Before (polling) | After (real-time) |
|---|---|---|
| **Latency to see changes** | 30–60 seconds | Under 1 second |
| **D1 database row reads** | ~5,000,000/day (hit free tier limit) | ~50–200/day |
| **Database scans** | 57,600 full table scans/day | 0 (indexed + cached) |
| **Outbound status checks** | Polling every 30 seconds | Instant (WebSocket push) |
| **Fallback** | N/A | 30-second polling auto-resumes if WebSocket disconnects |

---

## Security Architecture

### Defense in Depth

The EnQuote sync layer uses multiple independent security controls. If any single layer is compromised, the others continue to protect the system.

#### Layer 1: Cloudflare Access (Identity Verification)

- Every request to the Worker passes through **Cloudflare Access** — Cloudflare's Zero Trust network access product
- Users authenticate via Enphase's identity provider (SAML/OIDC) before reaching any endpoint
- The Worker cryptographically verifies the **Cloudflare Access JWT** (RS256 signed) against Access's public key set (JWKS) on every authenticated request
- An **email allow-list** (stored as an encrypted Worker secret, never in source code) restricts access to approved Enphase employees only
- **No static credentials** are shipped with the desktop installer — tokens are issued dynamically after identity verification

#### Layer 2: Webhook Integrity (Inbound from Base44)

- Every webhook from Base44 is signed with **HMAC-SHA256** using a shared secret known only to Base44 and the Worker
- The Worker performs a **timing-safe comparison** of the signature to prevent timing attacks
- The payload is encrypted with **AES-256-GCM** (authenticated encryption) — confidentiality and integrity in a single operation
- The decryption key is stored as a Cloudflare Worker secret (encrypted at rest, never in source code or git)
- **Idempotent deduplication** via delivery IDs prevents replay attacks — a replayed webhook is silently ignored

#### Layer 3: API Authentication (Outbound to Base44)

- The Worker authenticates to Base44 using an API key stored as an encrypted secret
- The desktop app authenticates to the Worker using a **Bearer token** (`OUTBOUND_TOKEN`) issued dynamically after Cloudflare Access verification
- Tokens are **never persisted** on the client machine — they exist only in memory for the current session

#### Layer 4: WebSocket Authentication

- WebSocket connections require the `X-ENQuote-Shared-Secret` header, verified against the `SNAPSHOT_TOKEN` Worker secret
- Auth check happens in the Worker's `fetch` handler (which has access to secrets) before the connection is upgraded
- The Durable Object never receives unauthenticated connections — it only processes requests forwarded by the Worker

#### Layer 5: Data Protection

- **D1 database**: Encrypted at rest by Cloudflare
- **KV cache**: Encrypted at rest by Cloudflare
- **Worker secrets**: Encrypted at rest, never exposed in logs, never committed to source code
- **In-transit**: All connections use TLS 1.3 (Worker ↔ Base44, Worker ↔ desktop app, WebSocket)
- **No data leaves the Cloudflare edge** — the Worker processes everything in-region, no third-party services involved

#### Layer 6: Infrastructure Security

- **No servers to patch** — serverless architecture means no OS-level vulnerabilities to manage
- **No open ports** — the Worker only accepts connections through Cloudflare's managed infrastructure
- **DDoS protection** — Cloudflare's global network absorbs volumetric attacks before they reach the Worker
- **Rate limiting** — Cloudflare's edge rate limiting can be applied to any endpoint without code changes
- **Audit trail** — Worker observability logs all requests, errors, and security events

### Secret Management

All sensitive values are stored as **Cloudflare Worker secrets** — encrypted at rest, injected at runtime, never in source code:

| Secret | Purpose | Rotated via |
|---|---|---|
| `SNAPSHOT_TOKEN` | Desktop app ↔ Worker auth (snapshot reads + WebSocket) | `wrangler secret put SNAPSHOT_TOKEN` |
| `OUTBOUND_TOKEN` | Desktop app ↔ Worker auth (outbound pushes) | `wrangler secret put OUTBOUND_TOKEN` |
| `ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` | HMAC-SHA256 webhook signature verification | `wrangler secret put ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` |
| `ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` | AES-256-GCM payload decryption | `wrangler secret put ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` |
| `BASE44_API_KEY` | Worker → Base44 API authentication | `wrangler secret put BASE44_API_KEY` |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token (client ID) | `wrangler secret put CF_ACCESS_CLIENT_ID` |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token (secret) | `wrangler secret put CF_ACCESS_CLIENT_SECRET` |
| `ALLOWED_EMAILS_LIST` | Email allow-list for Access identity verification | `wrangler secret put ALLOWED_EMAILS_LIST` |

Secrets can be rotated at any time without redeploying the Worker — changes take effect immediately.

---

## Salesforce Migration

### Why This Is Low-Risk

The EnQuote architecture was designed with a **decoupled middleware pattern**: the desktop application communicates only with the Cloudflare Worker, never directly with the backend data source. This means replacing Base44 with Salesforce is a **backend-only change** — the desktop application, real-time WebSocket push, KV caching, D1 storage, and Cloudflare Access authentication all continue to work identically.

**The 20 desktop users will not need a new installer. They will not need reconfiguration. They will not experience downtime.**

### What Changes (Worker Only)

Only two Worker modules need modification. Everything else — the Electron app, D1, KV, Durable Object, WebSocket, Access — remains untouched.

```
                    ┌─────────────────────────────────────────────┐
                    │           UNCHANGED (zero changes)            │
                    │                                              │
  ┌──────────┐      │  ┌──────────┐  ┌──────┐  ┌─────┐  ┌───────┐ │
  │ 20 Desktop│      │  │  Worker  │  │  KV  │  │ D1  │  │  DO   │ │
  │ Apps      │◄────►│  │  routes  │  │(cache)│  │(DB) │  │ (WS)  │ │
  │ (Electron)│      │  │  auth    │  └──────┘  └─────┘  └───────┘ │
  └──────────┘      │  │  queue    │                              │
                    │  │  status   │      CHANGED (2 modules):    │
                    │  └────┬─────┘      ┌─────────────────┐      │
                    │       │            │  webhook.js     │      │
                    │       │            │  (inbound auth  │      │
                    └───────┼───────────►│   + parsing)   │      │
                            │            ├─────────────────┤      │
                            │            │  pusher.js     │      │
                            │            │  (outbound API │      │
                            └───────────►│   + OAuth)     │      │
                                         └────────┬────────┘     │
                                                    │            │
                                         ┌────────▼────────┐    │
                                         │   Salesforce    │    │
                                         │   (REST API)     │    │
                                         └─────────────────┘    │
```

### Inbound: Salesforce → Worker

| Aspect | Base44 (current) | Salesforce (new) |
|---|---|---|
| **Webhook mechanism** | Custom encrypted payload | Salesforce Platform Events or Change Data Capture (CDC) |
| **Authentication** | HMAC-SHA256 signature verification | OAuth 2.0 token verification or Connected App JWT signature |
| **Encryption** | AES-256-GCM encrypted payload | TLS 1.3 in transit (Salesforce sends plaintext JSON via HTTPS) |
| **Deduplication** | `delivery_id` field | Salesforce event ID or replay ID |
| **Worker module** | `src/webhook.js` + `src/crypto.js` | New `src/salesforce-webhook.js` (auth verification + parsing) |

The rest of the inbound flow — D1 storage, KV cache refresh, Durable Object WebSocket push — is identical. Only the verification and parsing of the incoming payload changes.

### Outbound: Worker → Salesforce

| Aspect | Base44 (current) | Salesforce (new) |
|---|---|---|
| **Authentication** | Static API key in header | OAuth 2.0 access token (expires ~2 hours, requires refresh) |
| **Create quote** | `POST /api/apps/{appId}/entities/Quote` | `POST /services/data/v60.0/sobjects/Quote__c` |
| **Update quote** | `PUT /api/apps/{appId}/entities/Quote/{id}` | `PATCH /services/data/v60.0/sobjects/Quote__c/{id}` |
| **Find existing** | Base44 filter query | SOQL: `SELECT Id FROM Quote__c WHERE Quote_Number__c = '...'` |
| **Conflict detection** | Timestamp comparison | Salesforce `SystemModstamp` comparison |
| **Worker module** | `src/pusher.js` | New `src/salesforce-pusher.js` (OAuth + REST + SOQL) |

New requirement: **OAuth token management**. Salesforce access tokens expire, so the Worker must:
1. Exchange client credentials for an access token (client credentials flow)
2. Cache the token in KV with its expiry time
3. Refresh automatically when the token expires
4. Handle 401 responses with a token refresh + retry

### Secrets Transition

| Current Secret | New Secret | Notes |
|---|---|---|
| `BASE44_API_KEY` | `SALESFORCE_CLIENT_ID` | OAuth 2.0 client ID from Salesforce Connected App |
| `BASE44_APP_ID` | `SALESFORCE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `BASE44_API_URL` | `SALESFORCE_INSTANCE_URL` | e.g., `https://enphase.my.salesforce.com` |
| `ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` | `SALESFORCE_WEBHOOK_SECRET` | For verifying Salesforce webhook signatures |
| `ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` | *(not needed)* | Salesforce uses TLS, no payload encryption |

All secrets are rotated via `wrangler secret put` — no code deployment needed for secret changes.

### Migration Strategy: Parallel Run

The safest approach runs both backends simultaneously during the transition:

#### Phase 1: Add Salesforce as a parallel backend (no user impact)

- Add `src/salesforce-pusher.js` alongside the existing `src/pusher.js`
- Add `src/salesforce-webhook.js` alongside the existing `src/webhook.js`
- The Worker writes to both Base44 and Salesforce on every outbound push
- The Worker accepts webhooks from both Base44 and Salesforce on separate paths
- D1 stores data from both sources; the KV cache and WebSocket push work identically
- **Users see no change** — same app, same endpoints, same real-time updates

#### Phase 2: Validate Salesforce data

- Compare D1 records sourced from Base44 vs Salesforce for consistency
- Verify quote creation, updates, and conflict detection work correctly with Salesforce
- Confirm OAuth token refresh handles expiry gracefully
- Test with a subset of users if desired

#### Phase 3: Switch primary source

- Point the desktop app's snapshot reads at the Salesforce webhook path (Worker config change only)
- Stop writing to Base44 (remove the Base44 pusher call)
- **Users see no change** — still the same endpoints, same WebSocket, same real-time push

#### Phase 4: Decommission Base44

- Remove `src/pusher.js` (Base44 pusher) and `src/webhook.js` (Base44 webhook handler)
- Remove `src/crypto.js` (Base44 encryption/signature — not needed for Salesforce)
- Remove Base44 secrets from the Worker
- Clean up D1 `webhook_events` table for old Base44 delivery IDs

### What the Desktop Team Needs to Do

**Nothing.** The Electron app communicates only with the Worker. As long as the Worker's API contract stays the same — which it does — the desktop app is unaffected. No new installer, no reconfiguration, no downtime.

### Estimated Effort

| Task | Effort | Who |
|---|---|---|
| Create Salesforce Connected App (OAuth credentials) | 1 hour | Salesforce admin |
| Build `salesforce-pusher.js` (OAuth + REST + SOQL) | 4–6 hours | Developer |
| Build `salesforce-webhook.js` (auth + parsing) | 2–4 hours | Developer |
| Configure Salesforce Platform Events / CDC | 2 hours | Salesforce admin |
| Parallel run testing | 1–2 days | Developer + users |
| Cutover and Base44 decommission | 2 hours | Developer |

**Total: ~2–3 days of developer time + Salesforce admin setup.**

---

## Cloudflare Infrastructure Summary

| Component | Purpose | Cost |
|---|---|---|
| **Workers** | API endpoints, webhook handling, outbound push | $5/month base (10M requests included) |
| **D1** | SQLite database for quote storage + dedup | Included in Workers Paid (25B row reads/month) |
| **KV** | Cache for snapshot reads (eliminates D1 reads) | Included in Workers Paid (100M reads/month) |
| **Durable Objects** | WebSocket connections + real-time push | Usage-based (~$0.15/million requests, hibernates at idle) |
| **Queues** | Outbound retry with backoff + dead letter queue | Included in Workers Paid |
| **Cloudflare Access** | Zero Trust identity verification | Free for up to 50 users |

**Total monthly cost: ~$5–$8** for 20 users with real-time sync.

---

## Appendix: API Contract (Unchanged by Salesforce Migration)

The Worker exposes these endpoints. The desktop app uses only these — it never talks to Base44 or Salesforce directly.

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/auth/session` | GET | Verify Cloudflare Access identity | Access JWT |
| `/auth/sync-credentials` | GET | Issue sync tokens after auth | Access JWT |
| `/api/base44/webhook` | POST | Receive Base44 snapshots (inbound) | HMAC-SHA256 |
| `/api/salesforce/webhook` | POST | Receive Salesforce events (inbound, new) | OAuth/JWT |
| `/api/base44/webhook/snapshot-meta` | GET | Check if new data available | Shared secret |
| `/api/base44/webhook/snapshot` | GET | Pull full quote snapshot | Shared secret |
| `/api/outbound/enqueue` | POST | Push local change to backend | Bearer token |
| `/api/outbound/status` | GET | Check outbound push status (fallback) | Bearer token |
| `/ws` | WebSocket | Real-time push notifications | Shared secret |

This contract does not change when migrating to Salesforce. New inbound paths are added; existing paths continue to work.
