import { verifyRequestIdentity, checkBrowserOrigin } from "./auth-session.js";
import { effectiveUserFor, isAdminUser, rolesOf } from "./access.js";
import { performPush } from "./pusher.js";
import { broadcastMessage } from "./realtime.js";
import { ENTITY_COLLECTIONS } from "../../shared/entityCollections.js";
import { json } from "./util.js";

const ADMIN_ENTITIES = new Set(["Product", "PDFTemplate", "PVManufacturer", "EmailDistribution", "Invitation", "FST", "FollowUpConfig", "PriceReview"]);
const READ_ONLY = new Set(["User"]);

export async function handleEntityWrite(request, env) {
  const headers = { "Cache-Control": "no-store" };
  if (!checkBrowserOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403, headers);
  const identity = await verifyRequestIdentity(request, env);
  if (!identity.ok) return json({ ok: false, error: identity.reason }, identity.status, headers);
  const user = await effectiveUserFor(env, identity.email);
  if (!user || !rolesOf(user).length) return json({ ok: false, error: "role_required" }, 403, headers);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_body" }, 400, headers); }
  const { entityType, action, expectedVersion } = body || {};
  if (!ENTITY_COLLECTIONS[entityType] || READ_ONLY.has(entityType) || !["create", "update", "delete"].includes(action)) {
    return json({ ok: false, error: "invalid_operation" }, 400, headers);
  }
  const admin = isAdminUser(user);
  if ((ADMIN_ENTITIES.has(entityType) || (entityType === "Quote" && action === "delete")) && !admin) {
    return json({ ok: false, error: "admin_required" }, 403, headers);
  }
  if (!body.record || typeof body.record !== "object" || Array.isArray(body.record)) {
    return json({ ok: false, error: "invalid_record" }, 400, headers);
  }
  const id = action === "create" ? String(body.record.id || crypto.randomUUID()) : String(body.record.id || "");
  if (!id || id.length > 200) return json({ ok: false, error: "invalid_id" }, 400, headers);
  const stored = await env.DB.prepare(`
    SELECT record_json, action, synced_at FROM base44_entity_state WHERE entity_type = ? AND local_id = ?
  `).bind(entityType, id).first();
  let current = stored && stored.action !== "delete" ? JSON.parse(stored.record_json) : null;
  if (!current && entityType === "Quote" && action !== "create") {
    const row = await env.DB.prepare("SELECT payload FROM quotes WHERE id = ?").bind(id).first();
    if (row && stored?.action !== "delete") current = JSON.parse(row.payload);
  }
  if (action !== "create" && !current) return json({ ok: false, error: "not_found" }, 404, headers);
  if (action === "create" && stored) return json({ ok: false, error: "already_exists" }, 409, headers);
  if (expectedVersion != null && (stored?.synced_at || current?.updated_date) !== expectedVersion) {
    return json({ ok: false, error: "conflict", message: "This record changed. Refresh before saving." }, 409, headers);
  }
  const nextStatus = body.record.status;
  const isOwner = current?.created_by_id === user.id || current?.created_by === identity.email;
  if (entityType === "Quote" && nextStatus && nextStatus !== current?.status && !admin) {
    const roles = rolesOf(user);
    if (["approved", "rejected"].includes(nextStatus) && !roles.includes("approver")) {
      return json({ ok: false, error: "approver_required" }, 403, headers);
    }
    if (nextStatus === "invoiced" && !roles.some(role => ["approver", "invoicer"].includes(role))) {
      return json({ ok: false, error: "invoice_permission_required" }, 403, headers);
    }
    if (nextStatus === "invoice_paid" && !isOwner && !roles.some(role => ["approver", "invoicer"].includes(role))) {
      return json({ ok: false, error: "invoice_permission_required" }, 403, headers);
    }
  }
  const stamp = new Date().toISOString();
  const record = {
    ...current, ...body.record, id,
    created_by: current?.created_by || identity.email,
    created_by_id: current?.created_by_id || user.id,
    created_date: current?.created_date || stamp,
    updated_by: identity.email, updated_date: stamp
  };
  for (const key of ["_rev", "_synced_at", "base44_id", "base44_synced_at"]) delete record[key];
  try {
    const result = await performPush({
      entityType: entityType === "Quote" ? "quote" : entityType,
      action, localId: id, remoteId: action === "create" ? null : id,
      base44SyncedAt: current?.updated_date || null,
      quote: record, record
    }, env);
    if (result.status === "conflict") return json({ ok: false, error: "conflict" }, 409, headers);
    const remoteId = result.remote_id || id;
    const saved = { ...record, id: remoteId, local_quote_id: entityType === "Quote" ? record.local_quote_id || id : undefined, _synced_at: stamp };
    const statements = [env.DB.prepare(`
      INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
      VALUES (?, ?, ?, ?, 'browser', ?)
      ON CONFLICT(entity_type, local_id) DO UPDATE SET
        action = excluded.action, record_json = excluded.record_json,
        origin = excluded.origin, synced_at = excluded.synced_at
    `).bind(entityType, remoteId, action, action === "delete" ? "{}" : JSON.stringify(saved), stamp)];
    if (entityType === "Quote" && action === "delete") {
      statements.push(env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(id));
    }
    await env.DB.batch(statements);
    await broadcastMessage(env, { type: "entities_updated", entityType, lastSavedAt: stamp });
    return json({ ok: true, record: action === "delete" ? { id } : { ...saved, _rev: stamp } }, 200, headers);
  } catch (error) {
    console.error("[browser-write] Failed:", entityType, action, error.message);
    return json({ ok: false, error: "write_failed", message: "The shared service could not save this change. Refresh before retrying." }, 502, headers);
  }
}
