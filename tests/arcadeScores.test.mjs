import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {betterArcadeScore, validArcadeScore} from "../shared/arcadeScores.js";

test("scores have measurable bounds and correct ranking directions", () => {
  assert.equal(validArcadeScore("snake", 253), true);
  assert.equal(validArcadeScore("snake", 254), false);
  assert.equal(validArcadeScore("memory", 8), true);
  assert.equal(validArcadeScore("memory", 7), false);
  assert.equal(validArcadeScore("solitaire", 76), true);
  assert.equal(validArcadeScore("solitaire", 75), false);
  assert.equal(betterArcadeScore("snake", 10, 5), true);
  assert.equal(betterArcadeScore("memory", 8, 12), true);
  assert.equal(betterArcadeScore("solitaire", 100, 80), false);
  assert.equal(betterArcadeScore("snake", 5, 5), false);
});

test("personal bests are isolated per signed-in user, improve only, and expose storage errors", async () => {
  const output = await build({
    entryPoints: [path.resolve("src\\features\\Base44_DTO\\games\\personalScores.js")], bundle: true,
    write: false, format: "cjs", platform: "node", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const {readPersonalScores, recordPersonalScore} = module.exports;
  const storage = new Map([["enquote_local_session_email", "alice@example.com"]]);
  const original = globalThis.window;
  globalThis.window = {localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  }};
  try {
    assert.equal(recordPersonalScore("snake", 10), 10);
    assert.equal(recordPersonalScore("snake", 5), 10);
    assert.equal(recordPersonalScore("memory", 12), 12);
    assert.equal(recordPersonalScore("memory", 8), 8);
    storage.set("enquote_local_session_email", "bob@example.com");
    assert.deepEqual(readPersonalScores(), {});
    assert.equal(recordPersonalScore("snake", 1), 1);
    storage.set("enquote_local_session_email", "alice@example.com");
    assert.equal(readPersonalScores().snake, 10);
    storage.set("enspace_personal_scores_v1::alice@example.com", '{"snake":999}');
    assert.throws(readPersonalScores, /invalid/);
    storage.delete("enspace_personal_scores_v1::alice@example.com");
    window.localStorage.setItem = () => {throw new Error("Storage full");};
    assert.throws(() => recordPersonalScore("snake", 1), /Storage full/);
    storage.delete("enquote_local_session_email");
    assert.throws(() => recordPersonalScore("snake", 1), /Sign in/);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
