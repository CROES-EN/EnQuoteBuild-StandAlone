const assert = require("node:assert/strict");
const test = require("node:test");
const { createUpdatePrompt } = require("../../electron/updatePrompt.cjs");

test("choosing download installs and relaunches after the update is ready", async () => {
  const statuses = [];
  const calls = [];
  const prompt = createUpdatePrompt({
    showDialog: async (version) => {
      calls.push(["dialog", version]);
      return 0;
    },
    downloadUpdate: async () => calls.push(["download"]),
    installUpdate: () => calls.push(["install"]),
    sendStatus: (...args) => statuses.push(args),
    logger: { error() {} }
  });

  await prompt.offer("1.0.11");
  assert.deepEqual(calls, [["dialog", "1.0.11"], ["download"]]);
  assert.deepEqual(statuses, [["downloading", { version: "1.0.11", percent: 0 }]]);
  assert.equal(prompt.onDownloaded(), true);
  assert.deepEqual(calls.at(-1), ["install"]);
  assert.equal(prompt.onDownloaded(), false);
});

test("choosing later defers the same version for the rest of the session", async () => {
  const calls = [];
  const statuses = [];
  const prompt = createUpdatePrompt({
    showDialog: async (version) => {
      calls.push(["dialog", version]);
      return 1;
    },
    downloadUpdate: async () => calls.push(["download"]),
    installUpdate: () => calls.push(["install"]),
    sendStatus: (...args) => statuses.push(args),
    logger: { error() {} }
  });

  await prompt.offer("1.0.11");
  await prompt.offer("1.0.11");

  assert.deepEqual(calls, [["dialog", "1.0.11"]]);
  assert.deepEqual(statuses, [["deferred", { version: "1.0.11" }]]);
  assert.equal(prompt.onDownloaded(), false);
});

test("download errors reset the prompt so a later check can retry", async () => {
  const calls = [];
  let attempts = 0;
  const prompt = createUpdatePrompt({
    showDialog: async () => 0,
    downloadUpdate: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network unavailable");
    },
    installUpdate: () => calls.push("install"),
    sendStatus: (status) => calls.push(status),
    logger: { error() {} }
  });

  await prompt.offer("1.0.11");
  prompt.onError();
  await prompt.offer("1.0.11");

  assert.equal(attempts, 2);
  assert.deepEqual(calls, ["downloading", "error", "downloading"]);
  assert.equal(prompt.onDownloaded(), true);
  assert.deepEqual(calls.at(-1), "install");
});
