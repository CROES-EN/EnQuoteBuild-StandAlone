import test from "node:test";
import assert from "node:assert/strict";
import {createSupervisorD1} from "../test-helpers/d1Shim.js";
import {signUserToken} from "../src/user-token.js";
import {handleRetroGames} from "../src/retro-games.js";
import {initialOnlineGame, onlineMove, publicOnlineGame} from "../../shared/arcadeGames.js";
import {checkerMoves, randomFleet, strategyAction} from "../../shared/arcadeStrategy.js";

const ALICE = "alice@example.com", BOB = "bob@example.com", CAROL = "carol@example.com";
const envFor = () => ({
  DB: createSupervisorD1(["0012_retro_games.sql", "0014_retro_strategy.sql"]), USER_TOKEN_SECRET: "arcade-test-secret",
  OUTBOUND_TOKEN: "arcade-outbound-test", ALLOWED_EMAILS_LIST: [ALICE, BOB, CAROL].join(",")
});
async function request(env, email, body, suffix = "") {
  const response = await handleRetroGames(new Request(`https://worker.invalid/api/retro-games${suffix}`, {
    method: body ? "POST" : "GET",
    headers: {Authorization: `Bearer ${env.OUTBOUND_TOKEN}`, "X-EnQuote-User": await signUserToken(email, env.USER_TOKEN_SECRET)},
    ...(body ? {body: JSON.stringify(body)} : {})
  }), env);
  return {status: response.status, ...await response.json()};
}
const challenge = (env, kind = "tic") => request(env, ALICE, {id: crypto.randomUUID(), action: "challenge", kind, to: BOB});
const act = (env, email, game, action, extra = {}) => request(env, email, {id: game.id, version: game.version, action, ...extra});

test("private challenges list only participants, require recipient acceptance, and prevent stale moves", async () => {
  const env = envFor();
  const created = await challenge(env);
  assert.equal(created.status, 201);
  let game = created.game;
  assert.equal((await request(env, CAROL)).games.length, 0);
  assert.equal((await request(env, CAROL, null, `?id=${game.id}`)).status, 404);
  assert.equal((await act(env, CAROL, game, "accept")).status, 404);
  assert.equal((await act(env, ALICE, game, "accept")).status, 403);
  assert.equal((await act(env, ALICE, game, "move", {index: 0})).error, "game_not_active");
  game = (await act(env, BOB, game, "accept")).game;
  assert.equal(game.status, "active");
  assert.equal((await act(env, BOB, game, "move", {index: 0})).error, "not_your_turn");
  const prior = game;
  game = (await act(env, ALICE, game, "move", {index: 0})).game;
  assert.equal(game.board[0], "X");
  assert.equal((await act(env, ALICE, prior, "move", {index: 1})).error, "game_conflict");
  assert.equal((await act(env, BOB, game, "move", {index: 0})).error, "invalid_move");
  game = (await act(env, BOB, game, "move", {index: 3})).game;
  game = (await act(env, ALICE, game, "move", {index: 1})).game;
  game = (await act(env, BOB, game, "move", {index: 4})).game;
  game = (await act(env, ALICE, game, "move", {index: 2})).game;
  assert.equal(game.status, "finished");
  assert.equal(game.winner, ALICE);
  assert.equal((await act(env, BOB, game, "move", {index: 5})).error, "game_not_active");
});

test("memory cards are hidden in every response, matches keep turns, misses pass after reveal", async () => {
  const env = envFor();
  let game = (await challenge(env, "memory")).game;
  assert.ok(game.cards.every(card => card === null));
  assert.equal(JSON.stringify(game).includes("state_json"), false);
  game = (await act(env, BOB, game, "accept")).game;
  const row = (await env.DB.prepare("SELECT state_json FROM retro_games WHERE id = ?").bind(game.id).all()).results[0];
  const state = JSON.parse(row.state_json);
  const pair = state.cards.findIndex((card, i) => i !== 0 && card === state.cards[0]);
  game = (await act(env, ALICE, game, "move", {index: 0})).game;
  assert.equal(game.cards.filter(Boolean).length, 1);
  assert.equal((await act(env, ALICE, game, "move", {index: 0})).error, "invalid_move");
  game = (await act(env, ALICE, game, "move", {index: pair})).game;
  assert.equal(game.scores[ALICE], 1);
  assert.equal(game.turn, ALICE);
  const rest = state.cards.flatMap((symbol, index) => game.matched.includes(index) ? [] : [index]);
  const mismatch = rest.find(index => state.cards[index] !== state.cards[rest[0]]);
  game = (await act(env, ALICE, game, "move", {index: rest[0]})).game;
  game = (await act(env, ALICE, game, "move", {index: mismatch})).game;
  assert.equal(game.turn, BOB);
  assert.equal(game.open.length, 2);
  assert.equal((await act(env, BOB, game, "move", {index: rest[1]})).error, "cards_still_visible");
  assert.equal((await request(env, BOB)).games[0].cards.filter(Boolean).length, 4);
  const hidden = publicOnlineGame({...game, state: {...state, turn: BOB, matched: game.matched,
    open: game.open, revealUntil: 100, scores: game.scores}}, 101);
  assert.equal(hidden.cards.filter(Boolean).length, 2);
  assert.deepEqual(hidden.open, []);
});

test("memory finish and tie scores are decided by server state", () => {
  const cards = ["SUN", "SUN", "MOON", "MOON", "STAR", "STAR", "LEAF", "LEAF", "WAVE", "WAVE", "BOLT", "BOLT", "GEM", "GEM", "HEART", "HEART"];
  const state = {cards, matched: Array.from({length: 14}, (_, i) => i), open: [14],
    scores: {[ALICE]: 3, [BOB]: 4}, turn: ALICE, revealUntil: 0};
  const result = onlineMove({kind: "memory", status: "active", challenger: ALICE, opponent: BOB, state}, ALICE, 15, 1);
  assert.equal(result.status, "finished");
  assert.equal(result.state.winner, "draw");
  assert.equal(result.state.turn, null);
});

test("invitations are idempotent, duplicate matches are limited, and cancel/decline/resign work", async () => {
  const env = envFor();
  let game = (await challenge(env)).game;
  assert.equal((await request(env, ALICE, {id: game.id, action: "challenge", kind: "tic", to: BOB})).game.id, game.id);
  assert.equal((await challenge(env)).error, "challenge_limit_or_existing");
  assert.equal((await act(env, BOB, game, "cancel")).status, 403);
  assert.equal((await act(env, BOB, game, "decline")).game.status, "declined");
  game = (await challenge(env)).game;
  assert.equal((await act(env, ALICE, game, "cancel")).game.status, "cancelled");
  game = (await challenge(env)).game;
  game = (await act(env, BOB, game, "accept")).game;
  game = (await act(env, ALICE, game, "resign")).game;
  assert.equal(game.status, "finished");
  assert.equal(game.winner, BOB);
});

test("concurrent actions use a single atomic version check", async () => {
  const env = envFor();
  let game = (await challenge(env)).game;
  game = (await act(env, BOB, game, "accept")).game;
  const actions = await Promise.all([act(env, ALICE, game, "move", {index: 0}), act(env, ALICE, game, "move", {index: 1})]);
  assert.equal(actions.filter(result => result.ok).length, 1);
  assert.equal(actions.filter(result => result.error === "game_conflict").length, 1);
  const stored = (await request(env, BOB, null, `?id=${game.id}`)).game;
  assert.equal(stored.board.filter(Boolean).length, 1);
});

test("authentication, recipients, payloads, expiry and unknown actions remain explicit", async () => {
  const env = envFor();
  assert.equal((await handleRetroGames(new Request("https://worker.invalid/api/retro-games"), env)).status, 401);
  assert.equal((await request(env, ALICE, {id: crypto.randomUUID(), action: "challenge", kind: "snake", to: BOB})).error, "invalid_game_kind");
  assert.equal((await request(env, ALICE, {id: crypto.randomUUID(), action: "challenge", kind: "tic", to: ALICE})).error, "recipient_not_allowed");
  assert.equal((await request(env, ALICE, {id: crypto.randomUUID(), action: "challenge", kind: "tic", to: "outsider@example.net"})).error, "recipient_not_allowed");
  const game = (await challenge(env)).game;
  assert.equal((await act(env, ALICE, game, "cheat", {winner: ALICE})).error, "invalid_game_action");
  assert.equal((await request(env, ALICE, {id: game.id, action: "cancel", version: -1})).error, "invalid_version");
  await env.DB.prepare("UPDATE retro_games SET expires_at = 1 WHERE id = ?").bind(game.id).run();
  assert.equal((await request(env, BOB, null, `?id=${game.id}`)).game.status, "expired");
  assert.equal((await act(env, BOB, game, "accept")).error, "game_expired");
});

test("all five games retain accepted moves and turns when reopened, even after long inactivity", async () => {
  for (const kind of ["tic", "memory", "connect", "checkers", "battleship"]) {
    const env = envFor();
    let game = (await challenge(env, kind)).game;
    game = (await act(env, BOB, game, "accept")).game;
    if (kind === "battleship") {
      game = (await act(env, ALICE, game, "randomize")).game;
      game = (await act(env, BOB, game, "randomize")).game;
      game = (await act(env, ALICE, game, "ready")).game;
      game = (await act(env, BOB, game, "ready")).game;
    }
    const move = kind === "checkers" ? {from: 40, index: 33} : {index: 0};
    game = (await act(env, ALICE, game, "move", move)).game;
    assert.ok(game, kind);
    await env.DB.prepare("UPDATE retro_games SET updated_at = 1, expires_at = 1 WHERE id = ?").bind(game.id).run();
    const reopened = (await request({...env}, ALICE, null, `?id=${game.id}`)).game;
    assert.equal(reopened.status, "active", kind);
    assert.equal(reopened.turn, game.turn, kind);
    assert.deepEqual(reopened.board || reopened.cards || reopened.shots, game.board || game.cards || game.shots, kind);
    assert.equal((await request(env, BOB)).games[0].id, game.id);
    assert.equal((await challenge(env, kind)).error, "challenge_limit_or_existing");
    assert.ok((await act(env, BOB, reopened, "resign")).ok, "active matches never expire");
  }
});

test("Connect Four verifies gravity, full columns, wins in every direction, and draws", () => {
  const make = () => ({kind: "connect", challenger: ALICE, opponent: BOB, state: initialOnlineGame("connect", ALICE, BOB)});
  const game = make();
  for (const bad of [-1, 7, 1.5, "0"]) assert.equal(strategyAction(game, ALICE, {action: "move", index: bad}).error, "invalid_move");
  const dropped = strategyAction(game, ALICE, {action: "move", index: 0});
  assert.equal(dropped.state.board[35], ALICE);
  assert.equal(dropped.state.turn, BOB);
  for (const line of [[35,36,37], [14,21,28], [14,22,30], [20,26,32]]) {
    const g = make();
    for (const i of line) g.state.board[i] = ALICE;
    // Complete the line at row 5; pre-fill cells below earlier discs.
    const index = line[2] + (line[2] - line[1]);
    const result = strategyAction(g, ALICE, {action: "move", index: index % 7});
    assert.equal(result.state.winner, ALICE, JSON.stringify(line));
    assert.equal(result.status, "finished");
  }
  game.state.board = Array(42).fill(BOB);
  assert.equal(strategyAction(game, ALICE, {action: "move", index: 0}).error, "invalid_move");
  // A last move into a full alternating pattern without any line through the new disc.
  game.state.board = Array.from({length: 42}, (_, i) => (Math.floor(i / 7) + Math.floor((i % 7) / 2)) % 2 ? ALICE : BOB);
  game.state.board[0] = null;
  assert.equal(strategyAction(game, ALICE, {action: "move", index: 0}).state.winner, "draw");
});

test("Battleship saves manual setup, validates ships, hides fleets, locks ready, and ends after sinking all ships", async () => {
  const env = envFor();
  let game = (await challenge(env, "battleship")).game;
  game = (await act(env, BOB, game, "accept")).game;
  assert.equal((await act(env, ALICE, game, "ready")).error, "fleet_incomplete");
  assert.equal((await act(env, ALICE, game, "move", {index: 0})).error, "invalid_game_action");
  assert.equal((await act(env, ALICE, game, "place", {ship: 0, index: 8, vertical: false})).error, "invalid_move");
  game = (await act(env, ALICE, game, "place", {ship: 4, index: 0, vertical: true})).game;
  assert.deepEqual(game.fleet[4], [0,10]);
  const bobSetup = (await request(env, BOB, null, `?id=${game.id}`)).game;
  assert.equal(JSON.stringify(bobSetup).includes("fleets"), false);
  assert.deepEqual(bobSetup.fleet, []);
  assert.deepEqual(bobSetup.sunk, []);
  assert.deepEqual((await request(env, ALICE, null, `?id=${game.id}`)).game.fleet, game.fleet);
  assert.equal((await act(env, ALICE, game, "place", {ship: 0, index: 0, vertical: false})).error, "invalid_move");
  game = (await act(env, ALICE, game, "randomize")).game;
  assert.equal(new Set(game.fleet.flat()).size, 17);
  game = (await act(env, ALICE, game, "ready")).game;
  assert.equal((await act(env, ALICE, game, "randomize")).error, "fleet_already_ready");
  game = (await act(env, BOB, game, "randomize")).game;
  game = (await act(env, BOB, game, "ready")).game;
  assert.equal(game.phase, "playing");
  const row = (await env.DB.prepare("SELECT state_json FROM retro_games WHERE id = ?").bind(game.id).all()).results[0];
  const state = JSON.parse(row.state_json), targets = state.fleets[BOB].flat();
  let first = (await act(env, ALICE, game, "move", {index: targets[0]})).game;
  assert.deepEqual(first.shots, [{index: targets[0], hit: true}]);
  assert.equal(first.turn, BOB);
  assert.equal((await act(env, ALICE, first, "move", {index: targets[1]})).error, "not_your_turn");
  first = (await act(env, BOB, first, "move", {index: 0})).game;
  assert.equal((await act(env, ALICE, first, "move", {index: targets[0]})).error, "invalid_move");
  state.shots[ALICE] = targets.slice(0, -1);
  const result = strategyAction({kind: "battleship", challenger: ALICE, opponent: BOB, state}, ALICE, {action: "move", index: targets.at(-1)});
  assert.equal(result.status, "finished");
  assert.equal(result.state.winner, ALICE);
  const serialized = publicOnlineGame({kind: "battleship", challenger: ALICE, opponent: BOB, status: "finished", state: result.state}, 1, ALICE);
  assert.equal(serialized.sunk.length, 5);
  assert.equal(Object.hasOwn(serialized, "fleets"), false);
  for (let i = 0; i < 100; i++) assert.equal(new Set(randomFleet().flat()).size, 17);
});

test("Checkers enforces compulsory captures, multi-jumps, crowning, kings, blocked wins and quiet draws", () => {
  const make = () => ({kind: "checkers", challenger: ALICE, opponent: BOB, state: {
    board: Array(64).fill(null), turn: ALICE, winner: null, forced: null, quiet: 0}});
  const piece = (side = ALICE, king = false) => ({side, king, forward: side === ALICE ? -1 : 1});
  let game = make();
  game.state.board[42] = piece(); game.state.board[35] = piece(BOB); game.state.board[21] = piece(BOB);
  game.state.board[46] = piece();
  assert.deepEqual(checkerMoves(game.state, ALICE), [{from:42, to:28, captured:35}]);
  assert.equal(strategyAction(game, ALICE, {action:"move", from:46, index:37}).error, "invalid_move");
  let result = strategyAction(game, ALICE, {action:"move", from:42, index:28});
  assert.equal(result.state.forced, 28); assert.equal(result.state.turn, ALICE);
  game.state = result.state;
  result = strategyAction(game, ALICE, {action:"move", from:28, index:14});
  assert.equal(result.state.winner, ALICE); assert.equal(result.state.board[21], null);
  game = make();
  game.state.board[17] = piece(); game.state.board[10] = piece(BOB); game.state.board[12] = piece(BOB);
  result = strategyAction(game, ALICE, {action:"move", from:17, index:3});
  assert.equal(result.state.board[3].king, true); assert.equal(result.state.turn, BOB);
  assert.equal(result.state.forced, null, "promotion ends jump chain");
  game = make(); game.state.board[28] = piece(ALICE, true); game.state.board[62] = piece(BOB, true);
  result = strategyAction(game, ALICE, {action:"move", from:28, index:37});
  assert.equal(result.state.turn, BOB, "kings move backwards");
  game.state.quiet = 79;
  assert.equal(strategyAction(game, ALICE, {action:"move", from:28, index:37}).state.winner, "draw");
  game = make(); game.state.board[40] = piece(); game.state.board[56] = piece(BOB);
  assert.equal(strategyAction(game, ALICE, {action:"move", from:40, index:33}).state.winner, ALICE, "opponent cannot move");
});

test("strategy actions reject stale concurrent writes without losing private setup or moves", async () => {
  for (const kind of ["connect", "checkers", "battleship"]) {
    const env = envFor();
    let game = (await challenge(env, kind)).game;
    game = (await act(env, BOB, game, "accept")).game;
    const actions = kind === "battleship"
      ? [act(env, ALICE, game, "randomize"), act(env, BOB, game, "randomize")]
      : [act(env, ALICE, game, "move", kind === "connect" ? {index:0} : {from:40,index:33}),
        act(env, ALICE, game, "move", kind === "connect" ? {index:1} : {from:42,index:35})];
    const results = await Promise.all(actions);
    assert.equal(results.filter(result => result.ok).length, 1, kind);
    assert.equal(results.filter(result => result.error === "game_conflict").length, 1, kind);
    assert.equal((await request(env, CAROL, null, `?id=${game.id}`)).status, 404);
  }
});

test("expanding game kinds preserves old matches and their versions", async () => {
  const db = createSupervisorD1(["0012_retro_games.sql", {sql: `INSERT INTO retro_games VALUES
    ('old','tic','alice','bob','active','{"board":[]}',7,1,1,2);`}, "0014_retro_strategy.sql"]);
  const row = (await db.prepare("SELECT * FROM retro_games WHERE id = ?").bind("old").all()).results[0];
  assert.equal(row.version, 7);
  assert.equal(row.state_json, '{"board":[]}');
  assert.equal(row.expires_at, Number.MAX_SAFE_INTEGER);
});

test("reopening during a mandatory Checkers jump restores the same piece and continuation", async () => {
  const env = envFor();
  let game = (await challenge(env, "checkers")).game;
  game = (await act(env, BOB, game, "accept")).game;
  const state = initialOnlineGame("checkers", ALICE, BOB);
  state.board = Array(64).fill(null);
  state.board[42] = {side:ALICE, king:false, forward:-1};
  state.board[35] = state.board[21] = {side:BOB, king:false, forward:1};
  await env.DB.prepare("UPDATE retro_games SET state_json = ? WHERE id = ?").bind(JSON.stringify(state), game.id).run();
  game = (await act(env, ALICE, game, "move", {from:42,index:28})).game;
  const reopened = (await request(env, ALICE, null, `?id=${game.id}`)).game;
  assert.equal(reopened.forced, 28);
  assert.equal(reopened.turn, ALICE);
  assert.equal((await act(env, BOB, reopened, "move", {from:21,index:30})).error, "not_your_turn");
  assert.equal((await act(env, ALICE, reopened, "move", {from:28,index:14})).game.winner, ALICE);
});

test("active matches cannot be pushed out of the lobby by more than 100 recent records", async () => {
  const env = envFor();
  let game = (await challenge(env)).game;
  game = (await act(env, BOB, game, "accept")).game;
  await env.DB.prepare("UPDATE retro_games SET updated_at = 1 WHERE id = ?").bind(game.id).run();
  for (let i = 0; i < 105; i++) {
    await env.DB.prepare(`INSERT INTO retro_games
      (id,kind,challenger,opponent,status,state_json,version,created_at,updated_at,expires_at)
      VALUES (?,'tic',?,?,'finished',?,1,?,?,?)`)
      .bind(crypto.randomUUID(), ALICE, BOB, JSON.stringify(initialOnlineGame("tic", ALICE, BOB)), Date.now(), Date.now(), 1).run();
  }
  const listed = (await request(env, ALICE)).games;
  assert.equal(listed.length, 101);
  assert.equal(listed[0].id, game.id);
});
