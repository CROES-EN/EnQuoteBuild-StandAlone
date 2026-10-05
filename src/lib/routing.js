// Free, keyless routing helpers for the Resource Planner:
//   - geocoding via OpenStreetMap Nominatim (public usage policy: max 1 request/second)
//   - real driving distance/time via the public OSRM demo server
//   - "Open in Google Maps" deep links (no API key required)
// Everything here is browser-safe (both services send CORS headers).

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org";
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const OSRM_CHUNK_SIZE = 40;
const METERS_PER_MILE = 1609.344;

const US_STATE_CODES = new Set((
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI"
).split(" "));

// Two-letter state code from free-text like "123 Main St, Denver, CO 80202", or "".
export function stateFromAddress(address) {
  const text = String(address || "").replace(/[\r\n]+/g, " ");
  const candidates = [
    ...text.matchAll(/\b([A-Z]{2})\b\.?,?\s*\d{5}(?:-\d{4})?\b/g),
    ...text.matchAll(/,\s*([A-Z]{2})\.?\s*$/g)
  ];
  for (const match of candidates) {
    if (US_STATE_CODES.has(match[1])) return match[1];
  }
  return "";
}

let lastNominatimCall = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Strips what free-text geocoders choke on: unit/suite/apt numbers, "Uhaul:" prefixes,
// trailing "US" and line breaks.
export function cleanForGeocoding(address) {
  return String(address || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*uhaul:\s*/i, "")
    .replace(/[,\s]+(?:unit|apt|apartment|ste|suite)\s*#?\s*[\w-]+/gi, "")
    .replace(/[,\s]+#\s*[\w-]+/g, "")
    .replace(/[,\s]+(?:US|USA)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function nominatimSearch(params) {
  const wait = lastNominatimCall + NOMINATIM_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimCall = Date.now();

  const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: "json", limit: "1", countrycodes: "us", addressdetails: "1", ...params })}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  const isoState = /^US-([A-Z]{2})$/.exec(results[0].address?.["ISO3166-2-lvl4"] || "");
  return { lat: Number(results[0].lat), lng: Number(results[0].lon), state: isoState ? isoState[1] : "" };
}

// Resolves to {lat, lng, state}, or null when the address genuinely can't be found (so callers
// can remember that). Network/service failures throw instead and should not be cached.
export async function geocodeAddress(address) {
  const cleaned = cleanForGeocoding(address);
  if (!cleaned) return null;

  const localGeo = typeof window !== "undefined" ? window.enquoteLocal?.geo : null;
  if (localGeo?.geocode) {
    const result = await localGeo.geocode(cleaned);
    if (result?.ok) return result;
    if (result?.reason === "not_found") return null;
    throw new Error(result?.error || "Geocoding service unavailable");
  }

  const direct = await nominatimSearch({ q: cleaned });
  if (direct) return { ...direct, precision: "street", source: "osm", matchedAddress: "" };

  // Street-level lookups fail on typos/ranges ("6201 - 6261 White Ln"); a ZIP-centroid
  // is still close enough to rank FSTs by.
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(cleaned);
  if (zip) {
    const postal = await nominatimSearch({ postalcode: zip[1] });
    return postal ? { ...postal, precision: "zip", source: "osm-zip", matchedAddress: "" } : null;
  }
  return null;
}

export function straightLineMiles(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return (3958.8 * 2 * Math.asin(Math.sqrt(h)));
}

// Driving distance/time from one origin to many destinations. Returns an array aligned
// with `destinations`: {miles, minutes} or null where no road route exists
// (islands, unreachable points).
export async function drivingMatrix(origin, destinations) {
  const localGeo = typeof window !== "undefined" ? window.enquoteLocal?.geo : null;
  if (localGeo?.routes) {
    const routed = await localGeo.routes({ site: origin, origins: destinations });
    if (routed?.ok) return routed.results.map((r) => r?.fromSite || null);
    throw new Error(routed?.error || "Routing service unavailable");
  }

  const results = new Array(destinations.length).fill(null);

  for (let start = 0; start < destinations.length; start += OSRM_CHUNK_SIZE) {
    const chunk = destinations.slice(start, start + OSRM_CHUNK_SIZE);
    const coords = [origin, ...chunk].map((p) => `${p.lng},${p.lat}`).join(";");
    const destIndexes = chunk.map((_, i) => i + 1).join(";");
    const url = `${OSRM_URL}/table/v1/driving/${coords}?sources=0&destinations=${destIndexes}&annotations=duration,distance`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
    const body = await response.json();
    if (body.code !== "Ok") throw new Error(`Routing service error: ${body.code}`);

    chunk.forEach((_, i) => {
      const seconds = body.durations?.[0]?.[i];
      const meters = body.distances?.[0]?.[i];
      if (seconds != null && meters != null) {
        results[start + i] = { miles: meters / METERS_PER_MILE, minutes: seconds / 60 };
      }
    });
  }

  return results;
}

export async function drivingRoundTrips(site, origins) {
  const localGeo = typeof window !== "undefined" ? window.enquoteLocal?.geo : null;
  if (localGeo?.routes) {
    const routed = await localGeo.routes({ site, origins });
    if (routed?.ok) return routed.results;
    throw new Error(routed?.error || "Routing service unavailable");
  }

  const fromSite = await drivingMatrix(site, origins);
  const toSite = await Promise.all(origins.map(async (origin) => {
    const [result] = await drivingMatrix(origin, [site]);
    return result;
  }));
  return origins.map((_, i) => (fromSite[i] && toSite[i] ? { toSite: toSite[i], fromSite: fromSite[i] } : null));
}

export function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

export function googleMapsDirectionsUrl(origin, destination) {
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}
