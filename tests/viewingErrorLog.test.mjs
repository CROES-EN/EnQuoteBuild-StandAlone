import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";

test("viewing errors remain window-local, bounded and never access private/shared persistence", async () => {
  const previous = globalThis.window;
  globalThis.window = {
    enquotePreview: {active: true},
    enquoteLocal: new Proxy({}, {get() {assert.fail("Viewing error log accessed the native bridge");}}),
    localStorage: new Proxy({}, {get() {assert.fail("Viewing error log accessed persisted storage");}})
  };
  try {
    const bundle = await build({
      entryPoints: [path.resolve("src\\features\\developerConsole\\errorLog.js")],
      bundle: true, write: false, platform: "node", format: "cjs",
      alias: {"@": path.resolve("src")}
    });
    const module = {exports: {}};
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const {recordError, listErrors, clearErrors} = module.exports;
    for (let i = 0; i < 502; i++) await recordError({source: "view", message: `Error ${i}`, stack: "Do not persist"});
    const entries = await listErrors();
    assert.equal(entries.length, 500);
    assert.equal(entries[0].message, "Error 501");
    assert.equal(entries.at(-1).message, "Error 2");
    assert.equal(entries[0].stack, undefined);
    await clearErrors();
    assert.deepEqual(await listErrors(), []);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
