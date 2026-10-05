const fsp = require("node:fs/promises");
const path = require("node:path");
const process = require("node:process");

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org";
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/sources_to_targets";
const USER_AGENT = "EnQuote/1.3 (Enphase O&M quoting tool)";
const METERS_PER_MILE = 1609.344;
const GEOCODE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const OSRM_CHUNK_SIZE = 40;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 15000;

function cleanForGeocoding(address) {
  return String(address || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*uhaul:\s*/i, "")
    .replace(/[,\s]+(?:unit|apt|apartment|ste|suite)\s*#?\s*[\w-]+/gi, "")
    .replace(/[,\s]+#\s*[\w-]+/g, "")
    .replace(/[,\s]+(?:US|USA)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeAddress(address) {
  return cleanForGeocoding(address).toLowerCase().replace(/\s+/g, " ").trim();
}

function timeoutSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS).unref?.();
  return controller.signal;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonSafe(response) {
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response?.status || "error"}`);
  }
  return response.json();
}

function finiteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stateFromCensus(match) {
  return String(match?.addressComponents?.state || "").trim().toUpperCase();
}

function stateFromOsm(result) {
  const iso = /^US-([A-Z]{2})$/.exec(result?.address?.["ISO3166-2-lvl4"] || "");
  return iso ? iso[1] : String(result?.address?.state_code || "").trim().toUpperCase();
}

function cacheEntryFresh(entry, nowMs) {
  if (!entry) return false;
  const ttl = entry.status === "not_found" ? NOT_FOUND_TTL_MS : GEOCODE_TTL_MS;
  return nowMs - Number(entry.storedAt || 0) <= ttl;
}

function createGeoService({ fetchImpl, cachePath, now = () => Date.now(), logger = console } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required");
  if (!cachePath) throw new Error("cachePath is required");

  let cache = {};
  let loaded = false;
  let loadPromise = null;
  let writeTimer = null;
  let writePromise = Promise.resolve();
  let lastNominatimCall = 0;
  let nominatimQueue = Promise.resolve();
  const inflightGeocodes = new Map();

  async function loadCache() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await fsp.readFile(cachePath, "utf8");
          const parsed = JSON.parse(raw);
          cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch (err) {
          if (err?.code !== "ENOENT") logger?.warn?.(`Ignoring corrupt geo cache: ${err.message}`);
          cache = {};
        } finally {
          loaded = true;
        }
      })();
    }
    await loadPromise;
  }

  function pruneCache() {
    const entries = Object.entries(cache);
    if (entries.length <= MAX_CACHE_ENTRIES) return;
    entries
      .sort((a, b) => Number(a[1]?.storedAt || 0) - Number(b[1]?.storedAt || 0))
      .slice(0, entries.length - MAX_CACHE_ENTRIES)
      .forEach(([key]) => delete cache[key]);
  }

  function scheduleWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      writePromise = writePromise.then(async () => {
        try {
          pruneCache();
          await fsp.mkdir(path.dirname(cachePath), { recursive: true });
          const tmpPath = `${cachePath}.${process.pid}.tmp`;
          await fsp.writeFile(tmpPath, JSON.stringify(cache, null, 2), "utf8");
          await fsp.rename(tmpPath, cachePath);
        } catch (err) {
          logger?.warn?.(`Failed to write geo cache: ${err.message}`);
        }
      });
    }, 25);
    writeTimer.unref?.();
  }

  async function fetchJson(url, options = {}) {
    return readJsonSafe(await fetchImpl(url, { ...options, signal: timeoutSignal() }));
  }

  async function waitForNominatimSlot() {
    const previous = nominatimQueue;
    let release;
    nominatimQueue = new Promise((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      const wait = lastNominatimCall + NOMINATIM_MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastNominatimCall = now();
    } finally {
      release();
    }
  }

  async function nominatim(params) {
    await waitForNominatimSlot();
    const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: "json", limit: "1", countrycodes: "us", addressdetails: "1", ...params })}`;
    const body = await fetchJson(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
    if (!Array.isArray(body) || body.length === 0) return null;
    const first = body[0];
    const lat = finiteCoord(first.lat);
    const lng = finiteCoord(first.lon);
    if (lat == null || lng == null) return null;
    return { ok: true, lat, lng, state: stateFromOsm(first), precision: params.postalcode ? "zip" : "street", source: params.postalcode ? "osm-zip" : "osm", matchedAddress: first.display_name || "" };
  }

  async function lookupGeocode(cleaned) {
    const censusUrl = `${CENSUS_URL}?${new URLSearchParams({ address: cleaned, benchmark: "Public_AR_Current", format: "json" })}`;
    const census = await fetchJson(censusUrl, { headers: { Accept: "application/json" } });
    const match = census?.result?.addressMatches?.[0];
    const lat = finiteCoord(match?.coordinates?.y);
    const lng = finiteCoord(match?.coordinates?.x);
    if (lat != null && lng != null) {
      return { ok: true, lat, lng, state: stateFromCensus(match), precision: "street", source: "census", matchedAddress: match.matchedAddress || "" };
    }

    const street = await nominatim({ q: cleaned });
    if (street) return street;

    const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(cleaned);
    if (zip) {
      const zipResult = await nominatim({ postalcode: zip[1] });
      if (zipResult) return zipResult;
    }
    return { ok: false, reason: "not_found" };
  }

  async function geocode(address) {
    await loadCache();
    const cleaned = cleanForGeocoding(address);
    const key = normalizeAddress(cleaned);
    if (!key) return { ok: false, reason: "not_found" };

    const cached = cache[key];
    if (cacheEntryFresh(cached, now())) {
      cached.storedAt = cached.storedAt || now();
      if (cached.status === "not_found") return { ok: false, reason: "not_found" };
      return { ok: true, ...cached.result };
    }

    if (inflightGeocodes.has(key)) return inflightGeocodes.get(key);

    const promise = (async () => {
      try {
        const result = await lookupGeocode(cleaned);
        if (result.ok) {
          cache[key] = { status: "found", storedAt: now(), result: { lat: result.lat, lng: result.lng, state: result.state || "", precision: result.precision, source: result.source, matchedAddress: result.matchedAddress || "" } };
          scheduleWrite();
        } else if (result.reason === "not_found") {
          cache[key] = { status: "not_found", storedAt: now() };
          scheduleWrite();
        }
        return result;
      } catch (err) {
        return { ok: false, reason: "unreachable", error: err?.message || String(err) };
      } finally {
        inflightGeocodes.delete(key);
      }
    })();
    inflightGeocodes.set(key, promise);
    return promise;
  }

  function pointParam(point) {
    return `${Number(point.lng)},${Number(point.lat)}`;
  }

  function validPoint(point) {
    return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
  }

  async function osrmTable(site, chunk, direction) {
    const coords = [site, ...chunk].map(pointParam).join(";");
    const indexes = chunk.map((_, i) => i + 1).join(";");
    const query = direction === "fromSite"
      ? { sources: "0", destinations: indexes }
      : { sources: indexes, destinations: "0" };
    const url = `${OSRM_URL}/table/v1/driving/${coords}?${new URLSearchParams({ ...query, annotations: "duration,distance" })}`;
    const body = await fetchJson(url);
    if (body?.code !== "Ok") throw new Error(`OSRM ${body?.code || "error"}`);
    return chunk.map((_, i) => {
      const row = direction === "fromSite" ? 0 : i;
      const col = direction === "fromSite" ? i : 0;
      const seconds = body.durations?.[row]?.[col];
      const meters = body.distances?.[row]?.[col];
      return seconds == null || meters == null ? null : { miles: meters / METERS_PER_MILE, minutes: seconds / 60 };
    });
  }

  async function valhallaMatrix(sources, targets) {
    const body = await fetchJson(VALHALLA_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ sources: sources.map((p) => ({ lat: Number(p.lat), lon: Number(p.lng) })), targets: targets.map((p) => ({ lat: Number(p.lat), lon: Number(p.lng) })), costing: "auto", units: "miles" })
    });
    return body?.sources_to_targets || [];
  }

  async function valhallaRoutes(site, origins) {
    const results = new Array(origins.length).fill(null);
    for (let start = 0; start < origins.length; start += OSRM_CHUNK_SIZE) {
      const chunk = origins.slice(start, start + OSRM_CHUNK_SIZE);
      const fromSite = await valhallaMatrix([site], chunk);
      const toSite = await valhallaMatrix(chunk, [site]);
      chunk.forEach((_, i) => {
        const fs = fromSite?.[0]?.[i];
        const ts = toSite?.[i]?.[0];
        if (fs?.time != null && fs?.distance != null && ts?.time != null && ts?.distance != null) {
          results[start + i] = {
            toSite: { miles: Number(ts.distance), minutes: Number(ts.time) / 60 },
            fromSite: { miles: Number(fs.distance), minutes: Number(fs.time) / 60 }
          };
        }
      });
    }
    return results;
  }

  async function osrmRoutes(site, origins) {
    const results = new Array(origins.length).fill(null);
    for (let start = 0; start < origins.length; start += OSRM_CHUNK_SIZE) {
      const chunk = origins.slice(start, start + OSRM_CHUNK_SIZE);
      const fromSite = await osrmTable(site, chunk, "fromSite");
      const toSite = await osrmTable(site, chunk, "toSite");
      chunk.forEach((_, i) => {
        if (fromSite[i] && toSite[i]) results[start + i] = { toSite: toSite[i], fromSite: fromSite[i] };
      });
    }
    return results;
  }

  async function routes({ site, origins } = {}) {
    const list = Array.isArray(origins) ? origins : [];
    if (!validPoint(site) || list.some((p) => !validPoint(p))) {
      return { ok: false, reason: "invalid_input", error: "site and origins must contain numeric lat/lng" };
    }
    try {
      return { ok: true, source: "osrm", results: await osrmRoutes(site, list) };
    } catch (osrmErr) {
      try {
        return { ok: true, source: "valhalla", results: await valhallaRoutes(site, list) };
      } catch (valhallaErr) {
        return { ok: false, reason: "unreachable", error: valhallaErr?.message || osrmErr?.message || "Routing services unavailable" };
      }
    }
  }

  return { geocode, routes };
}

module.exports = { createGeoService, cleanForGeocoding, normalizeAddress };
