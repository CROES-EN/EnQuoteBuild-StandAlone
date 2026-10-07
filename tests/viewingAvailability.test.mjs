import assert from "node:assert/strict";
import test from "node:test";
import {getViewingAvailability, startDesktopViewing, VIEWING_RESTART_MESSAGE} from "../src/features/admin/viewingAvailability.js";

test("preload methods alone cannot enable viewing mode on an older main process", async () => {
  let starts = 0;
  const bridge = {start: async () => {starts++; return {ok: true};}};
  assert.deepEqual(await getViewingAvailability(bridge), {ready: false, message: VIEWING_RESTART_MESSAGE});
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), /fully quit/);
  assert.equal(starts, 0);
  bridge.status = async () => {throw new Error("Error invoking remote method 'viewing:status': Error: No handler registered for 'viewing:status'");};
  assert.deepEqual(await getViewingAvailability(bridge), {ready: false, message: VIEWING_RESTART_MESSAGE});
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), /new desktop release/);
  assert.equal(starts, 0);
});

test("startup-not-ready status blocks Start and can be rechecked after initialization", async () => {
  let ready = false;
  const bridge = {
    status: async () => ({ok: true, supported: true, ready}),
    start: async email => {assert.equal(email, "heather@example.com"); return {ok: true};}
  };
  assert.match((await getViewingAvailability(bridge)).message, /initializing/);
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), /initializing/);
  ready = true;
  assert.deepEqual(await getViewingAvailability(bridge), {ready: true, message: ""});
  await startDesktopViewing("heather@example.com", bridge);
});

test("missing start handler gives restart guidance, but authorization and unexpected failures remain explicit", async () => {
  const bridge = {
    status: async () => ({ok: true, supported: true, ready: true}),
    start: async () => {throw new Error("Error invoking remote method 'viewing:start': Error: No handler registered for 'viewing:start'");}
  };
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), /fully quit/);
  const denied = new Error("Live Super Admin authorization is required.");
  bridge.start = async () => {throw denied;};
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), error => error === denied);
  bridge.start = async () => ({ok: false, error: "Target account unavailable"});
  await assert.rejects(startDesktopViewing("heather@example.com", bridge), /Target account unavailable/);
  bridge.status = async () => {throw denied;};
  await assert.rejects(getViewingAvailability(bridge), error => error === denied);
  bridge.status = async () => ({ok: true});
  await assert.rejects(getViewingAvailability(bridge), /invalid viewing-mode capability/);
});
