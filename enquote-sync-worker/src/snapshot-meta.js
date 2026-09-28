import { getSnapshotMeta } from "./repository.js";
import { json } from "./util.js";

export async function handleSnapshotMeta(request, env) {
    if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
        return json({error: "unauthorized"}, 401);
    }
    const lastSavedAt = await getSnapshotMeta(env.DB);
    return json({ok: true, lastSavedAt });
    }