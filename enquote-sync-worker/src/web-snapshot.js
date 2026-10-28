import { verifyRequestIdentity } from "./auth-session.js";
import { buildSnapshotAllEntities, snapshotVersion } from "./snapshot-all-entities.js";
import { json } from "./util.js";

export async function handleWebSnapshot(request, env) {
  const auth = await verifyRequestIdentity(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, X-EnQuote-User" };
  if (new URL(request.url).searchParams.has("meta")) {
    return json({ ok: true, ...await snapshotVersion(env.DB) }, 200, headers);
  }
  const snapshot = await buildSnapshotAllEntities(env);
  const quotes = snapshot.quotes.map(record => ({ ...record, _rev: record._synced_at }));
  return json({ ...snapshot, quotes, entities: { ...snapshot.entities, Quote: quotes }, authenticated_email: auth.email }, 200, headers);
}
