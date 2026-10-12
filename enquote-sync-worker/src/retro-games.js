import {allowedEmails, authenticateUser} from "./user-token.js";
import {json} from "./util.js";
import {ONLINE_GAME_NAMES, initialOnlineGame, onlineMove, publicOnlineGame} from "../../shared/arcadeGames.js";
import {STRATEGY_KINDS, strategyAction} from "../../shared/arcadeStrategy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error, status = 400) => json({ok: false, error}, status);
const select = `SELECT id, kind, challenger, opponent, status, state_json, version,
  created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt FROM retro_games`;
const decode = row => row ? {...row, state: JSON.parse(row.state_json)} : null;
const cleanGame = row => {
  const game = decode(row);
  if (game) delete game.state_json;
  return game;
};

export async function handleRetroGames(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const now = Date.now();
  const visible = game => publicOnlineGame(game, now, user.email);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      if (!UUID.test(id)) return fail("invalid_game_id");
      const {results} = await env.DB.prepare(`${select} WHERE id = ? AND (challenger = ? OR opponent = ?)`)
        .bind(id, user.email, user.email).all();
      const game = cleanGame(results[0]);
      return game ? json({ok: true, game: visible(game), serverNow: now}) : fail("game_not_found", 404);
    }
    const {results} = await env.DB.prepare(`${select}
      WHERE (challenger = ? OR opponent = ?) AND (status = 'active' OR id IN
        (SELECT id FROM retro_games WHERE (challenger = ? OR opponent = ?) AND status != 'active'
          AND updated_at >= ? ORDER BY updated_at DESC LIMIT 100))
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC`)
      .bind(user.email, user.email, user.email, user.email, now - 7 * 86400000).all();
    return json({ok: true, me: user.email, players: allowedEmails(env).filter(email => email !== user.email),
      games: results.map(row => visible(cleanGame(row))), serverNow: now});
  }
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  if (Number(request.headers.get("Content-Length") || 0) > 2048) return fail("request_too_large", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2048) return fail("request_too_large", 413);
  let body;
  try {body = JSON.parse(raw);} catch {return fail("invalid_json");}
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_json");
  if (!UUID.test(body.id || "")) return fail("invalid_game_id");
  if (body.action === "challenge") {
    const opponent = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
    if (typeof body.kind !== "string" || !Object.hasOwn(ONLINE_GAME_NAMES, body.kind)) return fail("invalid_game_kind");
    if (opponent === user.email || !allowedEmails(env).includes(opponent)) return fail("recipient_not_allowed");
    const existing = await env.DB.prepare(`${select} WHERE id = ?`).bind(body.id).all();
    if (existing.results.length) {
      const game = cleanGame(existing.results[0]);
      return game.challenger === user.email && game.opponent === opponent && game.kind === body.kind
        ? json({ok: true, game: visible(game), serverNow: now}) : fail("game_id_conflict", 409);
    }
    const state = initialOnlineGame(body.kind, user.email, opponent);
    const inserted = await env.DB.prepare(`INSERT INTO retro_games
      (id, kind, challenger, opponent, status, state_json, version, created_at, updated_at, expires_at)
      SELECT ?, ?, ?, ?, 'pending', ?, 1, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM retro_games WHERE challenger = ? AND (status = 'active' OR (status = 'pending' AND expires_at > ?))) < 20
      AND NOT EXISTS (SELECT 1 FROM retro_games WHERE kind = ? AND (status = 'active' OR (status = 'pending' AND expires_at > ?))
        AND ((challenger = ? AND opponent = ?) OR (challenger = ? AND opponent = ?)))
      ON CONFLICT(id) DO NOTHING`)
      .bind(body.id, body.kind, user.email, opponent, JSON.stringify(state), now, now, now + 86400000,
        user.email, now, body.kind, now, user.email, opponent, opponent, user.email).run();
    if (!inserted.meta?.changes) {
      const concurrent = await env.DB.prepare(`${select} WHERE id = ?`).bind(body.id).all();
      const game = cleanGame(concurrent.results[0]);
      if (game?.challenger === user.email && game.opponent === opponent && game.kind === body.kind) {
        return json({ok: true, game: visible(game), serverNow: now});
      }
      return fail("challenge_limit_or_existing", 409);
    }
    const game = {id: body.id, kind: body.kind, challenger: user.email, opponent, status: "pending", state,
      version: 1, createdAt: now, updatedAt: now, expiresAt: now + 86400000};
    return json({ok: true, game: visible(game), serverNow: now}, 201);
  }
  if (!Number.isSafeInteger(body.version) || body.version < 1) return fail("invalid_version");
  const {results} = await env.DB.prepare(`${select} WHERE id = ? AND (challenger = ? OR opponent = ?)`)
    .bind(body.id, user.email, user.email).all();
  const game = cleanGame(results[0]);
  if (!game) return fail("game_not_found", 404);
  if (game.version !== body.version) return fail("game_conflict", 409);
  if (game.status === "pending" && game.expiresAt <= now) return fail("game_expired", 409);
  let next;
  if (body.action === "accept" || body.action === "decline") {
    if (game.status !== "pending" || user.email !== game.opponent) return fail("invalid_game_action", 403);
    next = {...game, status: body.action === "accept" ? "active" : "declined",
      expiresAt: body.action === "accept" ? Number.MAX_SAFE_INTEGER : game.expiresAt};
  } else if (body.action === "cancel") {
    if (game.status !== "pending" || user.email !== game.challenger) return fail("invalid_game_action", 403);
    next = {...game, status: "cancelled"};
  } else if (body.action === "resign") {
    if (game.status !== "active") return fail("game_not_active", 409);
    next = {...game, status: "finished", state: {...game.state, turn: null,
      winner: user.email === game.challenger ? game.opponent : game.challenger, resignedBy: user.email}};
  } else if (["move", "place", "randomize", "ready"].includes(body.action)) {
    if (game.status !== "active") return fail("game_not_active", 409);
    const moved = STRATEGY_KINDS.includes(game.kind) ? strategyAction(game, user.email, body)
      : body.action === "move" ? onlineMove(game, user.email, body.index, now) : {error: "invalid_game_action"};
    if (moved.error) return fail(moved.error, 409);
    next = {...game, ...moved};
  } else return fail("invalid_game_action");
  const updated = await env.DB.prepare(`UPDATE retro_games SET status = ?, state_json = ?, version = version + 1,
    updated_at = ?, expires_at = ? WHERE id = ? AND version = ?`)
    .bind(next.status, JSON.stringify(next.state), now, next.expiresAt, game.id, game.version).run();
  if (!updated.meta?.changes) return fail("game_conflict", 409);
  return json({ok: true, game: visible({...next, version: game.version + 1, updatedAt: now}), serverNow: now});
}
