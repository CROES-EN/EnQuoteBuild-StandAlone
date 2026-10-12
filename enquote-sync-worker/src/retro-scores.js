import {authenticateUser, allowedEmails} from "./user-token.js";
import {json} from "./util.js";
import {SCORE_GAMES, validArcadeScore} from "../../shared/arcadeScores.js";

export async function handleRetroScores(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  if (request.method === "GET") {
    const emails = allowedEmails(env);
    const boards = {};
    for (const kind of Object.keys(SCORE_GAMES)) {
      const order = SCORE_GAMES[kind].direction === "highest" ? "DESC" : "ASC";
      const {results} = await env.DB.prepare(`SELECT email, value, updated_at AS updatedAt FROM retro_scores
        WHERE kind = ? AND email IN (SELECT value FROM json_each(?)) ORDER BY value ${order}, updated_at ASC, email ASC LIMIT 10`)
        .bind(kind, JSON.stringify(emails)).all();
      boards[kind] = results;
    }
    const {results} = await env.DB.prepare("SELECT kind, value FROM retro_scores WHERE email = ?").bind(user.email).all();
    return json({ok: true, boards, personal: Object.fromEntries(results.map(row => [row.kind, row.value]))});
  }
  if (request.method !== "POST") return json({ok: false, error: "method_not_allowed"}, 405);
  if (Number(request.headers.get("Content-Length") || 0) > 1024) return json({ok: false, error: "request_too_large"}, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1024) return json({ok: false, error: "request_too_large"}, 413);
  let body;
  try {body = JSON.parse(text);} catch {return json({ok: false, error: "invalid_json"}, 400);}
  if (!body || !validArcadeScore(body.kind, body.value) || body.completed !== true) return json({ok: false, error: "invalid_score"}, 400);
  const highest = SCORE_GAMES[body.kind].direction === "highest";
  await env.DB.prepare(`INSERT INTO retro_scores (email, kind, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE excluded.value ${highest ? ">" : "<"} retro_scores.value`)
    .bind(user.email, body.kind, body.value, Date.now()).run();
  const {results} = await env.DB.prepare("SELECT value FROM retro_scores WHERE email = ? AND kind = ?").bind(user.email, body.kind).all();
  return json({ok: true, kind: body.kind, best: results[0].value});
}
