import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

const output = await build({
  stdin: {contents: 'export * from "@/features/travel/rankFsts"; export {stateFromAddress} from "@/lib/routing";', resolveDir: path.resolve(".")},
  bundle: true, write: false, platform: "node", format: "cjs", alias: {"@": path.resolve("src")}
});
const module = {exports: {}};
new Function("module", "exports", "require", output.outputFiles[0].text)(module, module.exports, () => ({}));
const {rankFsts, stateFromAddress} = module.exports;

const point = (lat, lng, precision = "street") => ({lat, lng, precision, source: "test", matchedAddress: ""});
const cached = (address, geo) => ({address, ...geo});

test("a ZIP-only FST in the same city ranks by drive time, not below farther exact matches", async () => {
  const site = point(29.4241, -98.4936);
  const fsts = [
    {id: "rick", name: "Rick", home_address: "13831 Kingsbury hill, San Antonio TX, 78217", home_state: "TX"},
    {id: "evian", name: "Evian", home_address: "9613 Juniper Knoll, San Antonio, TX 78254", home_state: "TX"},
    {id: "chris", name: "Chris", home_address: "1505 Jackson Dr Cedar Park TX 78613", home_state: "TX"}
  ];
  fsts[0].home_geo = cached(fsts[0].home_address, point(29.567, -98.405));
  fsts[1].home_geo = cached(fsts[1].home_address, point(29.528, -98.695, "zip"));
  fsts[2].home_geo = cached(fsts[2].home_address, point(30.467, -97.817));
  const minutes = {rick: 24, evian: 30, chris: 114};
  globalThis.window = {enquoteLocal: {geo: {
    geocode: async () => ({ok: true, ...site, state: "TX"}),
    routes: async ({origins}) => ({ok: true, results: origins.map(o => {
      const id = fsts.find(f => f.home_geo.lat === o.lat).id;
      const leg = {miles: minutes[id] / 2, minutes: minutes[id]};
      return {toSite: leg, fromSite: leg};
    })})
  }}};
  try {
    const {results, searchScope} = await rankFsts({address: "san antonio, TX", activeFSTs: fsts});
    assert.equal(searchScope.state, "TX");
    assert.deepEqual(results.map(r => r.fst.id), ["rick", "evian", "chris"]);
    assert.equal(results[1].zipApproximate, true);
  } finally {
    delete globalThis.window;
  }
});

test("state codes are read regardless of capitalization", () => {
  assert.equal(stateFromAddress("1833 fenwick pl Santa Rosa ca 95401"), "CA");
  assert.equal(stateFromAddress("10715 Ridgewood Dr, Greenville, Mi,48838"), "MI");
  assert.equal(stateFromAddress("316 Miners Trail, Grass Valley, Ca. 95945"), "CA");
  assert.equal(stateFromAddress("san antonio, tx"), "TX");
  assert.equal(stateFromAddress("6265 scarlett court Dublin California 94568"), "");
});
