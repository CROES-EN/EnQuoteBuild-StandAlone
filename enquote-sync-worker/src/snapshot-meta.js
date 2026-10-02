import { readSnapshotCache } from "./snapshot-cache.js";
import { json } from "./util.js";

export async function handleSnapshotMeta(request, env) {
    if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
        return json({error: "unauthorized"}, 401);
    }
    const snapshot = await readSnapshotCache(env);
    return json({ok: true, lastSavedAt: snapshot.lastSavedAt });
    }