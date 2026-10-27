// Location quality for FST roster addresses. home_geo/ship_geo store where an address was
// located; they only count while geo.address still matches the address text, so editing an
// address (an FST moving) automatically invalidates the old location.

export const LOCATION_FIELDS = [
  { addressField: "home_address", geoField: "home_geo", label: "Home" },
  { addressField: "shipping_address", geoField: "ship_geo", label: "Ship To" }
];

export const LOCATION_STATUS = {
  pinned: { label: "Pinned", hint: "Exact spot set by hand", tone: "good" },
  street: { label: "Located", hint: "Matched to the street address", tone: "good" },
  zip: { label: "ZIP only", hint: "Only the ZIP code was found - drive times are approximate. Set the pin.", tone: "warn" },
  not_found: { label: "Not found", hint: "This address couldn't be located. Fix it or set the pin.", tone: "bad" },
  pending: { label: "Not checked", hint: "Not located yet - it's checked on save or the next route search.", tone: "muted" },
  missing: { label: "No address", hint: "", tone: "muted" }
};

export function locationStatus(address, geo) {
  const text = String(address || "").trim();
  if (!text) return "missing";
  if (!geo || geo.address !== address) return "pending";
  if (geo.lat == null || geo.lng == null) return geo.precision === undefined ? "pending" : "not_found";
  if (geo.precision === "pinned") return "pinned";
  if (geo.precision === "zip") return "zip";
  return geo.precision ? "street" : "pending";
}

export const needsAttention = (status) => status === "zip" || status === "not_found";

export function fstNeedsAttention(fst) {
  return LOCATION_FIELDS.some(({ addressField, geoField }) => needsAttention(locationStatus(fst[addressField], fst[geoField])));
}

const validPair = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// Accepts "29.5282, -98.6948", Google Maps place links (!3d..!4d..), ?q=lat,lng links and
// @lat,lng view links. Returns {lat, lng} or null.
export function parseCoordinates(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (validPair(lat, lng)) return { lat, lng };
  }
  return null;
}

export function geoFromLookup(address, point) {
  return {
    address,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    precision: point?.precision || null,
    source: point?.source || null,
    matchedAddress: point?.matchedAddress || ""
  };
}

export function pinnedGeo(address, { lat, lng }, { by = "", previous } = {}) {
  return {
    address,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    precision: "pinned",
    source: "manual",
    matchedAddress: previous?.matchedAddress || "",
    pinnedBy: by,
    pinnedAt: new Date().toISOString()
  };
}

// Locates every address on an FST record that isn't located yet. Blank addresses and
// locations left over from an older address are cleared; failed lookups are reported
// instead of swallowed so the caller can tell the user (routing retries them later).
export async function locateFstAddresses(record, lookup) {
  const next = { ...record };
  const failures = [];
  for (const { addressField, geoField, label } of LOCATION_FIELDS) {
    const address = next[addressField] || "";
    if (!address.trim()) { next[geoField] = null; continue; }
    if (locationStatus(address, next[geoField]) !== "pending") continue;
    try {
      next[geoField] = await lookup(address);
    } catch (error) {
      next[geoField] = null;
      failures.push({ label, address, message: error?.message || "Location lookup failed" });
    }
  }
  return { record: next, failures };
}

export const googleMapsPointUrl = ({ lat, lng }) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
