import test from "node:test";
import assert from "node:assert/strict";
import {createSupervisorD1} from "../test-helpers/d1Shim.js";
import {signUserToken} from "../src/user-token.js";
import {handleRetroScores} from "../src/retro-scores.js";

const ALICE = "alice@example.com", BOB = "bob@example.com";
const makeEnv = () => ({
  DB: createSupervisorD1(["0013_retro_scores.sql"]), USER_TOKEN_SECRET: "scores-test-secret",
  OUTBOUND_TOKEN: "scores-test-outbound", ALLOWED_EMAILS_LIST: `${ALICE},${BOB}`
});
async function call(env, email, body) {
  const response = await handleRetroScores(new Request("https://worker.invalid/api/retro-scores", {
    method: body ? "POST" : "GET",
    headers: {Authorization: `Bearer ${env.OUTBOUND_TOKEN}`, "X-EnQuote-User": await signUserToken(email, env.USER_TOKEN_SECRET)},
    ...(body ? {body: JSON.stringify(body)} : {})
  }), env);
  return {status: response.status, ...await response.json()};
}
const score = (env, email, kind, value) => call(env, email, {kind, value, completed: true});

test("leaderboards rank high Snake scores and low completion moves while preserving each personal best", async () => {
  const env = makeEnv();
  await score(env, ALICE, "snake", 10);
  await score(env, BOB, "snake", 12);
  assert.equal((await score(env, ALICE, "snake", 5)).best, 10);
  await score(env, ALICE, "memory", 20);
  await score(env, BOB, "memory", 15);
  assert.equal((await score(env, ALICE, "memory", 30)).best, 20);
  await score(env, ALICE, "solitaire", 120);
  await score(env, BOB, "solitaire", 100);
  const result = await call(env, ALICE);
  assert.deepEqual(result.boards.snake.map(row => row.value), [12, 10]);
  assert.deepEqual(result.boards.memory.map(row => row.value), [15, 20]);
  assert.deepEqual(result.boards.solitaire.map(row => row.value), [100, 120]);
  assert.deepEqual(result.personal, {memory: 20, snake: 10, solitaire: 120});
});

test("score submissions use verified identity, reject impossible scores, and hide inactive users", async () => {
  const env = makeEnv();
  assert.equal((await handleRetroScores(new Request("https://worker.invalid/api/retro-scores"), env)).status, 401);
  for (const [kind, value] of [["snake", 254], ["snake", -1], ["memory", 7], ["memory", 8.5], ["solitaire", 75], ["tic", 1], ["__proto__", 1], [{}, 10]]) {
    assert.equal((await score(env, ALICE, kind, value)).error, "invalid_score");
  }
  assert.equal((await call(env, ALICE, {kind: "snake", value: 5, completed: false})).error, "invalid_score");
  await call(env, BOB, {email: ALICE, kind: "snake", value: 8, completed: true});
  assert.equal((await call(env, ALICE)).personal.snake, undefined, "sender cannot record for another player");
  env.ALLOWED_EMAILS_LIST = ALICE;
  assert.equal((await call(env, ALICE)).boards.snake.length, 0, "former users are excluded from shared boards");
});

test("concurrent/repeated submissions never lower a best or duplicate a leaderboard entry", async () => {
  const env = makeEnv();
  await Promise.all([score(env, ALICE, "snake", 10), score(env, ALICE, "snake", 12), score(env, ALICE, "snake", 11)]);
  await Promise.all([score(env, ALICE, "memory", 20), score(env, ALICE, "memory", 8), score(env, ALICE, "memory", 15)]);
  await score(env, ALICE, "snake", 12);
  const result = await call(env, ALICE);
  assert.equal(result.personal.snake, 12);
  assert.equal(result.personal.memory, 8);
  assert.equal(result.boards.snake.length, 1);
});

test("leaderboards return exactly the top ten with deterministic tie ordering", async () => {
  const env = makeEnv();
  const players = Array.from({length: 15}, (_, i) => `player${String(i).padStart(2, "0")}@example.com`);
  env.ALLOWED_EMAILS_LIST = [ALICE, ...players].join(",");
  for (const [index, email] of players.entries()) {
    await env.DB.prepare("INSERT INTO retro_scores (email,kind,value,updated_at) VALUES (?,?,?,?)")
      .bind(email, "snake", index, 1).run();
    await env.DB.prepare("INSERT INTO retro_scores (email,kind,value,updated_at) VALUES (?,?,?,?)")
      .bind(email, "memory", 8, index + 1).run();
  }
  const result = await call(env, ALICE);
  assert.equal(result.boards.snake.length, 10);
  assert.deepEqual(result.boards.snake.map(row => row.value), [14,13,12,11,10,9,8,7,6,5]);
  assert.deepEqual(result.boards.memory.map(row => row.email), players.slice(0, 10));
});
