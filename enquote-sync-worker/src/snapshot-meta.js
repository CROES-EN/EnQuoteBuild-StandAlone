import { getSnapshotMeta } from "./repository.js";
import { json } from "./util.js";

// Polled by every app; a single indexed row read, never a full snapshot or a KV write.
export async function handleSnapshotMeta(request, env) {
    if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
        return json({error: "unauthorized"}, 401);
    }
    const lastSavedAt = await getSnapshotMeta(env.DB);
    return json({ok: true, lastSavedAt });
    }