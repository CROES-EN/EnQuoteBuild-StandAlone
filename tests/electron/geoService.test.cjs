const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createGeoService } = require("../../electron/geoService.cjs");

const outRoot = path.join(os.tmpdir(), `enquote-geo-test-${process.pid}`);
const quiet = { info() {}, warn() {}, error() {} };

test.after(() => fs.rm(outRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {}));

async function testCachePath(name) {
  await fs.mkdir(outRoot, { recursive: true });
  return path.join(outRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function advancingNow() {
  let t = 0;
  return () => (t += 2000);
}

test("geocode returns Census street matches", async () => {
  const calls = [];
  const geo = createGeoService({
    cachePath: await testCachePath("census"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async (url) => {
      calls.push(url);
      assert.match(String(url), /geocoding\.geo\.census\.gov/);
      return response({ result: { addressMatches: [{ matchedAddress: "123 MAIN ST, DENVER, CO, 80202", coordinates: { x: -104.99, y: 39.74 }, addressComponents: { state: "CO" } }] } });
    }
  });

  assert.deepEqual(await geo.geocode("Uhaul: 123 Main St Apt 4\nDenver, CO 80202, USA"), {
    ok: true,
    lat: 39.74,
    lng: -104.99,
    state: "CO",
    precision: "street",
    source: "census",
    matchedAddress: "123 MAIN ST, DENVER, CO, 80202"
  });
  assert.equal(calls.length, 1);
});

test("geocode falls back from Census miss to Nominatim street", async () => {
  const calls = [];
  const geo = createGeoService({
    cachePath: await testCachePath("osm"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      if (String(url).includes("census")) return response({ result: { addressMatches: [] } });
      assert.equal(options.headers["User-Agent"], "EnQuote/1.3 (Enphase O&M quoting tool)");
      return response([{ lat: "40.1", lon: "-105.2", display_name: "OSM Match", address: { "ISO3166-2-lvl4": "US-CO" } }]);
    }
  });

  const result = await geo.geocode("123 Main St, Boulder, CO");
  assert.equal(result.ok, true);
  assert.equal(result.source, "osm");
  assert.equal(result.precision, "street");
  assert.equal(result.state, "CO");
  assert.equal(calls.length, 2);
});

test("geocode falls back from OSM street miss to ZIP centroid", async () => {
  const calls = [];
  const geo = createGeoService({
    cachePath: await testCachePath("zip"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("census")) return response({ result: { addressMatches: [] } });
      if (String(url).includes("postalcode=80202")) return response([{ lat: "39.75", lon: "-104.99", display_name: "80202", address: { "ISO3166-2-lvl4": "US-CO" } }]);
      return response([]);
    }
  });

  const result = await geo.geocode("bad range Denver CO 80202");
  assert.equal(result.ok, true);
  assert.equal(result.source, "osm-zip");
  assert.equal(result.precision, "zip");
  assert.equal(calls.length, 3);
});

test("geocode caches hits, expires old hits, and caches not_found", async () => {
  let nowMs = 1_000_000;
  let calls = 0;
  const cachePath = await testCachePath("cache");
  const geo = createGeoService({
    cachePath,
    now: () => nowMs,
    logger: quiet,
    fetchImpl: async () => {
      calls += 1;
      return response({ result: { addressMatches: [{ matchedAddress: "A", coordinates: { x: -1, y: 2 }, addressComponents: { state: "TX" } }] } });
    }
  });

  assert.equal((await geo.geocode("1 A St")).source, "census");
  assert.equal((await geo.geocode("1 A St")).source, "census");
  assert.equal(calls, 1);

  const expired = {};
  expired["old st"] = { status: "found", storedAt: nowMs - 181 * 24 * 60 * 60 * 1000, result: { lat: 1, lng: 2, state: "", precision: "street", source: "census", matchedAddress: "old" } };
  await fs.writeFile(cachePath, JSON.stringify(expired), "utf8");
  const geoExpired = createGeoService({ cachePath, now: () => nowMs, logger: quiet, fetchImpl: async () => { calls += 1; return response({ result: { addressMatches: [{ matchedAddress: "NEW", coordinates: { x: -3, y: 4 }, addressComponents: { state: "CA" } }] } }); } });
  assert.equal((await geoExpired.geocode("old st")).matchedAddress, "NEW");

  let missCalls = 0;
  const missGeo = createGeoService({
    cachePath: await testCachePath("miss"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async (url) => {
      missCalls += 1;
      return String(url).includes("census") ? response({ result: { addressMatches: [] } }) : response([]);
    }
  });
  assert.deepEqual(await missGeo.geocode("no such place"), { ok: false, reason: "not_found" });
  assert.deepEqual(await missGeo.geocode("no such place"), { ok: false, reason: "not_found" });
  assert.equal(missCalls, 2);
});

test("unreachable geocode results are not cached", async () => {
  let calls = 0;
  const geo = createGeoService({
    cachePath: await testCachePath("unreachable"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return response({ result: { addressMatches: [{ matchedAddress: "B", coordinates: { x: 6, y: 5 }, addressComponents: { state: "AZ" } }] } });
    }
  });

  assert.equal((await geo.geocode("2 B St")).reason, "unreachable");
  assert.equal((await geo.geocode("2 B St")).ok, true);
  assert.equal(calls, 2);
});

test("identical geocodes are de-duplicated while in flight", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const geo = createGeoService({
    cachePath: await testCachePath("dedupe"),
    now: advancingNow(),
    logger: quiet,
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return response({ result: { addressMatches: [{ matchedAddress: "C", coordinates: { x: 8, y: 7 }, addressComponents: { state: "UT" } }] } });
    }
  });

  const a = geo.geocode("3 C St");
  const b = geo.geocode("3 C St");
  release();
  const results = await Promise.all([a, b]);
  assert.equal(results[0].matchedAddress, "C");
  assert.deepEqual(results[0], results[1]);
  assert.equal(calls, 1);
});

test("routes returns OSRM round trips in both directions", async () => {
  let calls = 0;
  const geo = createGeoService({
    cachePath: await testCachePath("osrm"),
    logger: quiet,
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /router\.project-osrm\.org/);
      const parsed = new URL(String(url));
      if (parsed.searchParams.get("sources") === "0") {
        return response({ code: "Ok", durations: [[600, 1200]], distances: [[1609.344, 3218.688]] });
      }
      return response({ code: "Ok", durations: [[660], [1320]], distances: [[2414.016], [4023.36]] });
    }
  });

  const result = await geo.routes({ site: { lat: 1, lng: 2 }, origins: [{ lat: 3, lng: 4 }, { lat: 5, lng: 6 }] });
  assert.equal(result.ok, true);
  assert.equal(result.source, "osrm");
  assert.equal(calls, 2);
  assert.deepEqual(result.results[0], { toSite: { miles: 1.5, minutes: 11 }, fromSite: { miles: 1, minutes: 10 } });
  assert.deepEqual(result.results[1], { toSite: { miles: 2.5, minutes: 22 }, fromSite: { miles: 2, minutes: 20 } });
});

test("routes falls back to Valhalla sources_to_targets when OSRM fails", async () => {
  let osrmCalls = 0;
  let valhallaCalls = 0;
  const geo = createGeoService({
    cachePath: await testCachePath("valhalla"),
    logger: quiet,
    fetchImpl: async (url, options) => {
      if (String(url).includes("router.project-osrm.org")) {
        osrmCalls += 1;
        return response({ code: "Error" }, 500);
      }
      valhallaCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.costing, "auto");
      assert.equal(body.units, "miles");
      if (valhallaCalls === 1) {
        return response({ sources_to_targets: [[{ time: 300, distance: 4.25 }]] });
      }
      return response({ sources_to_targets: [[{ time: 360, distance: 4.75 }]] });
    }
  });

  const result = await geo.routes({ site: { lat: 1, lng: 2 }, origins: [{ lat: 3, lng: 4 }] });
  assert.equal(result.ok, true);
  assert.equal(result.source, "valhalla");
  assert.equal(osrmCalls, 1);
  assert.equal(valhallaCalls, 2);
  assert.deepEqual(result.results[0], { toSite: { miles: 4.75, minutes: 6 }, fromSite: { miles: 4.25, minutes: 5 } });
});
