import { handleWebhook } from "./webhook.js";
import { handleSnapshot } from "./snapshot.js";
import { handleSnapshotMeta } from "./snapshot-meta.js";
import { handleRealtimeSocket, QuoteSyncRoom } from "./realtime.js";
import { handleInboundBase44 } from "./inbound.js";
import { handleEntitySnapshot } from "./entity-snapshot.js";
import { handleAuthSession, handleSyncCredentials } from "./auth-session.js";
import { handlePresenceHeartbeat, handlePresenceList, handlePresenceRemove } from "./presence.js";
import { handleFstList, handleFstUpsert } from "./fsts.js";
import { handleUsers } from "./users.js";
import { handleUiBundle, handleUiManifest } from "./ui-updates.js";
import { handleErrorList, handleErrorReport } from "./errors.js";
import {
  handleSupervisorDelete,
  handleSupervisorIndex,
  handleSupervisorRecord,
  handleSupervisorUpsert
} from "./supervisor.js";
import { handleEnqueue } from "./outbound.js";
import { handleStatus } from "./status.js";
import { pushToBase44 } from "./pusher.js";
import { markOutboundStatus } from "./repository.js";
import { json } from "./util.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.method === "GET") return handleRealtimeSocket(request, env);
    if (url.pathname === "/api/base44/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot-meta" && request.method === "GET") return handleSnapshotMeta(request, env);
    if (url.pathname === "/api/outbound/enqueue" && request.method === "POST") return handleEnqueue(request, env);
    if (url.pathname === "/api/inbound/base44" && request.method === "POST") return handleInboundBase44(request, env);
    if (url.pathname === "/api/base44/webhook/entity-snapshot" && request.method === "GET") return handleEntitySnapshot(request, env);
    if (url.pathname === "/api/outbound/status" && request.method === "GET") return handleStatus(request, env);
    if (url.pathname === "/auth/session" && request.method === "GET") return handleAuthSession(request, env);
    if (url.pathname === "/auth/sync-credentials" && request.method === "GET") return handleSyncCredentials(request, env);
    if (url.pathname === "/api/presence/heartbeat" && request.method === "POST") return handlePresenceHeartbeat(request, env);
    if (url.pathname === "/api/presence" && request.method === "GET") return handlePresenceList(request, env);
    if (url.pathname === "/api/presence/remove" && request.method === "POST") return handlePresenceRemove(request, env);
    if (url.pathname === "/api/users" && request.method === "GET") return handleUsers(request, env);
    if (url.pathname === "/api/errors" && request.method === "POST") return handleErrorReport(request, env);
    if (url.pathname === "/api/errors" && request.method === "GET") return handleErrorList(request, env);
    if (url.pathname === "/api/ui/manifest" && request.method === "GET") return handleUiManifest(request, env);
    if (url.pathname === "/api/ui/bundle" && request.method === "GET") return handleUiBundle(request, env);
    if (url.pathname === "/api/fsts" && request.method === "GET") return handleFstList(request, env);
    if (url.pathname === "/api/fsts/upsert" && request.method === "POST") return handleFstUpsert(request, env);
    if (url.pathname === "/api/supervisor/index" && request.method === "GET") return handleSupervisorIndex(request, env);
    if (url.pathname === "/api/supervisor/record" && request.method === "GET") return handleSupervisorRecord(request, env);
    if (url.pathname === "/api/supervisor/upsert" && request.method === "POST") return handleSupervisorUpsert(request, env);
    if (url.pathname === "/api/supervisor/delete" && request.method === "POST") return handleSupervisorDelete(request, env);
    return json({ error: "not_found" }, 404);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await pushToBase44(message.body, env);
        message.ack();
      } catch (err) {
        if (err.retryable) throw err;
        await markOutboundStatus(env.DB, message.body.itemId, "error", { errorMessage: err.message });
        message.ack();
      }
    }
  },
};

export { QuoteSyncRoom };