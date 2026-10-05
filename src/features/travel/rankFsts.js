import { drivingRoundTrips, geocodeAddress, stateFromAddress, straightLineMiles } from "@/lib/routing";

export const MAX_ROUTED_CANDIDATES = 25;
export const CLOSE_MILES = 150;
const ROAD_FACTOR = 1.25;
const ESTIMATE_MPH = 50;

export const pickOrigin = (fst, startFrom) => {
  const home = { address: fst.home_address || "", field: "home_geo" };
  const ship = { address: fst.shipping_address || "", field: "ship_geo" };
  const [first, second] = startFrom === "shipping" ? [ship, home] : [home, ship];
  return first.address ? first : second;
};

export const originState = (fst, origin) => {
  const fallback = origin.field === "home_geo" ? fst.home_state || fst.state : fst.state || fst.home_state;
  const code = String(fallback || "").trim().toUpperCase();
  return stateFromAddress(origin.address) || (/^[A-Z]{2}$/.test(code) ? code : "");
};

export function cityStateFromAddress(address) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return `${parts[parts.length - 2]}, ${parts[parts.length - 1].replace(/\b\d{5}(?:-\d{4})?\b.*$/, "").trim()}`.replace(/,\s*$/, "");
  return parts.slice(-2).join(", ");
}

function isUsableCachedGeo(cached, address) {
  return cached && cached.address === address && cached.lat != null && cached.lng != null && cached.precision;
}

function estimatedRoute(straightMiles) {
  const oneWayMiles = straightMiles * ROAD_FACTOR;
  const oneWayMinutes = (oneWayMiles / ESTIMATE_MPH) * 60;
  return {
    toSite: { miles: oneWayMiles, minutes: oneWayMinutes },
    fromSite: { miles: oneWayMiles, minutes: oneWayMinutes }
  };
}

function routeTotals(route) {
  return {
    miles: route.toSite.miles + route.fromSite.miles,
    minutes: route.toSite.minutes + route.fromSite.minutes
  };
}

export async function rankFsts({ address, startFrom = "home", activeFSTs = [], onProgress, persistGeo } = {}) {
  const target = String(address || "").trim();
  if (!target) throw new Error("Enter a site address first.");
  if (!Array.isArray(activeFSTs) || activeFSTs.length === 0) {
    const err = new Error("No active FSTs in the roster. Please add FSTs first.");
    err.code = "NO_FSTS";
    throw err;
  }

  onProgress?.("Locating site visit address...");
  const sitePoint = await geocodeAddress(target);
  if (!sitePoint) {
    const err = new Error("Couldn't find that address. Check the street, city and ZIP and try again.");
    err.code = "SITE_NOT_FOUND";
    throw err;
  }

  const siteState = stateFromAddress(target) || sitePoint.state || "";
  const entries = activeFSTs.map((fst) => ({ fst, state: originState(fst, pickOrigin(fst, startFrom)) }));
  const sameState = siteState ? entries.filter((e) => e.state === siteState) : entries;
  const otherStates = siteState ? entries.filter((e) => e.state !== siteState) : [];
  const located = [];
  let skipped = 0;
  let done = 0;

  const locateFst = async (fst) => {
    const preferred = pickOrigin(fst, startFrom);
    const alternate = preferred.field === "home_geo"
      ? { address: fst.shipping_address || "", field: "ship_geo" }
      : { address: fst.home_address || "", field: "home_geo" };

    for (const { address: originAddress, field } of [preferred, alternate]) {
      if (!originAddress) continue;
      const cached = fst[field];
      if (isUsableCachedGeo(cached, originAddress)) return { ...cached, address: originAddress };
      const point = await geocodeAddress(originAddress);
      await persistGeo?.(fst, field, { address: originAddress, lat: point?.lat ?? null, lng: point?.lng ?? null, precision: point?.precision || null, source: point?.source || null, matchedAddress: point?.matchedAddress || "" });
      if (point) return { ...point, address: originAddress };
    }
    return null;
  };

  const locateAll = async (list) => {
    for (const entry of list) {
      done += 1;
      const origin = pickOrigin(entry.fst, startFrom);
      if (origin.address && !isUsableCachedGeo(entry.fst[origin.field], origin.address)) {
        onProgress?.(`Locating FST addresses (${done}/${activeFSTs.length}) - first run only, results are saved...`);
      }
      const point = await locateFst(entry.fst);
      if (point) located.push({ ...entry, point, straight: straightLineMiles(sitePoint, point) });
      else skipped += 1;
    }
  };

  await locateAll(sameState);
  let widened = false;
  if (siteState && !located.some((e) => e.straight <= CLOSE_MILES)) {
    widened = true;
    await locateAll(otherStates);
  }

  if (located.length === 0) {
    const err = new Error("None of the FSTs have an address that could be located. Check the roster addresses.");
    err.code = "NO_LOCATED_FSTS";
    throw err;
  }

  onProgress?.("Calculating drive times...");
  const candidates = located
    .sort((a, b) => a.straight - b.straight)
    .slice(0, MAX_ROUTED_CANDIDATES);

  let routes = [];
  let routingFailed = false;
  try {
    routes = await drivingRoundTrips(sitePoint, candidates.map((c) => c.point));
  } catch {
    routingFailed = true;
    routes = candidates.map(() => null);
  }

  const results = candidates.map((c, i) => {
    const zipApprox = sitePoint.precision === "zip" || c.point.precision === "zip";
    const route = routes[i] || estimatedRoute(c.straight);
    const roundTrip = routeTotals(route);
    const routeApproximate = routingFailed || !routes[i];
    return {
      fst: c.fst,
      inState: Boolean(siteState) && c.state === siteState,
      originAddress: c.point.address,
      originCityState: cityStateFromAddress(c.point.address),
      sitePoint,
      originPoint: c.point,
      route,
      oneWay: route.fromSite,
      roundTrip,
      miles: route.fromSite.miles,
      minutes: route.fromSite.minutes,
      approximate: zipApprox || routeApproximate,
      zipApproximate: zipApprox,
      routeApproximate
    };
  }).sort((a, b) => {
    if (a.approximate !== b.approximate) return a.approximate ? 1 : -1;
    return a.roundTrip.minutes - b.roundTrip.minutes;
  });

  return { results, skippedCount: skipped, searchScope: { state: siteState, widened }, sitePoint };
}
