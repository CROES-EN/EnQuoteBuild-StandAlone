import { handleWebhook } from "./webhook.js";
import { handleSnapshot } from "./snapshot.js";
import { handleSnapshotMeta } from "./snapshot-meta.js";
import { handleInboundBase44 } from "./inbound.js";
import { handleEntitySnapshot } from "./entity-snapshot.js";
import { handleAuthSession } from "./auth-session.js";
import { handleEnqueue } from "./outbound.js";
import { handleStatus } from "./status.js";
import { pushToBase44 } from "./pusher.js";
import { markOutboundStatus } from "./repository.js";
import { json } from "./util.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/base44/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot-meta" && request.method === "GET") return handleSnapshotMeta(request, env);
    if (url.pathname === "/api/outbound/enqueue" && request.method === "POST") return handleEnqueue(request, env);
    if (url.pathname === "/api/inbound/base44" && request.method === "POST") return handleInboundBase44(request, env);
    if (url.pathname === "/api/base44/webhook/entity-snapshot" && request.method === "GET") return handleEntitySnapshot(request, env);
    if (url.pathname === "/api/outbound/status" && request.method === "GET") return handleStatus(request, env);
    if (url.pathname === "/auth/session" && request.method === "GET") return handleAuthSession(request);
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