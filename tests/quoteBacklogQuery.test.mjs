import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/supervisorDashboard/useQuoteBacklog.js", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false, external: ["@tanstack/react-query"]
});
const module = {exports: {}};
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  () => ({useQuery: options => options}), module, module.exports
);
const {useQuoteBacklog} = module.exports;
const date = "2026-10-12";
const snapshot = () => ({date, capturedAt: "2026-10-13T05:59:00Z", timeZone: "America/Denver", count: 1,
  statusCounts: {approved: 1}, rows: [{quote: {id: "q1", status: "approved"}, alert: {overdueHours: 100}}]});
const bridge = response => {
  globalThis.window = {enquoteLocal: {quoteBacklog: {get: async requested => {
    assert.equal(requested, date);
    return response;
  }}}};
};
test.after(() => {delete globalThis.window;});

test("daily backlog query accepts frozen/live snapshots, missing history and polls only today", async () => {
  for (const live of [true, false]) {
    const response = {ok: true, live, snapshot: snapshot()};
    bridge(response);
    const query = useQuoteBacklog(date);
    assert.deepEqual(await query.queryFn(), response);
    assert.equal(query.refetchInterval({state: {data: response}}), live ? 60000 : false);
  }
  bridge({ok: true, live: false, snapshot: null});
  assert.equal((await useQuoteBacklog(date).queryFn()).snapshot, null);
  assert.equal(useQuoteBacklog("").enabled, false);
});

test("daily backlog query surfaces unavailable bridge, server failures and malformed snapshots", async () => {
  globalThis.window = {};
  await assert.rejects(useQuoteBacklog(date).queryFn(), /Restart after installing/);
  bridge({ok: false, error: "service unavailable"});
  await assert.rejects(useQuoteBacklog(date).queryFn(), /service unavailable/);
  bridge({ok: true});
  await assert.rejects(useQuoteBacklog(date).queryFn(), /response is invalid/);
  for (const invalid of [false, undefined, {live: true, snapshot: null}]) {
    bridge(invalid && typeof invalid === "object" ? {ok: true, ...invalid} : {ok: true, live: false, snapshot: invalid});
    await assert.rejects(useQuoteBacklog(date).queryFn(), /snapshot is invalid/);
  }
  for (const changes of [{count: 40}, {date: "2026-10-13"}, {capturedAt: "invalid"},
    {statusCounts: {approved: 2}}, {statusCounts: {approved: -1}}, {statusCounts: [1]}, {rows: [null]},
    {rows: [{quote: {id: "q1", status: "approved"}, alert: {overdueHours: "100"}}]}]) {
    bridge({ok: true, live: false, snapshot: {...snapshot(), ...changes}});
    await assert.rejects(useQuoteBacklog(date).queryFn(), /snapshot is invalid/);
  }
});

test("an undeployed backlog endpoint gives setup guidance without inventing a snapshot", async () => {
  for (const error of ["not_found", "http_404"]) {
    bridge({ok: false, error});
    await assert.rejects(useQuoteBacklog(date).queryFn(), /not enabled on the sync server yet.*database migration/);
    globalThis.window.enquoteLocal.quoteBacklog.get = async () => {
      throw new Error(`Error invoking remote method 'quoteBacklog:get': Error: ${error}`);
    };
    await assert.rejects(useQuoteBacklog(date).queryFn(), /not enabled on the sync server yet.*database migration/);
  }
  const failure = new Error("Could not reach the sync service");
  globalThis.window.enquoteLocal.quoteBacklog.get = async () => {throw failure;};
  await assert.rejects(useQuoteBacklog(date).queryFn(), error => error === failure);
});
