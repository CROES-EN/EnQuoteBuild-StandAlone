import {lazy, Suspense, useCallback, useEffect, useRef, useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Crosshair, ExternalLink, Loader2, MapPin, Search} from "lucide-react";
import {geocodeAddress} from "@/lib/routing";
import {geoFromLookup, googleMapsPointUrl, LOCATION_STATUS, locationStatus, parseCoordinates, pinnedGeo} from "@/lib/fstLocation";
import LocationStatusBadge from "./LocationStatusBadge";

const LocationPinMap = lazy(() => import("./LocationPinMap"));

export async function lookupGeo(address) {
  return geoFromLookup(address, await geocodeAddress(address));
}

// Address box for an FST plus where that address actually is: look it up, check it on a
// satellite map, and drag/click/paste to pin the exact spot when the lookup is off.
export default function FstAddressLocator({ label, placeholder, address, geo, onAddressChange, onGeoChange, onLocatingChange, pinnedBy }) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [coordsText, setCoordsText] = useState("");
  const status = locationStatus(address, geo);
  const point = geo && geo.address === address && geo.lat != null ? { lat: geo.lat, lng: geo.lng } : null;
  // A lookup can finish after the address was edited, a pin was set, or the dialog closed;
  // only the newest lookup for the address still in the box may apply its result.
  const latestAddress = useRef(address);
  const lookupId = useRef(0);
  latestAddress.current = address;

  useEffect(() => { onLocatingChange?.(locating); }, [locating, onLocatingChange]);
  useEffect(() => () => {
    lookupId.current += 1;
    onLocatingChange?.(false);
  }, [onLocatingChange]);

  const locate = async () => {
    if (!address.trim()) return;
    const id = ++lookupId.current;
    const requested = address;
    setLocating(true);
    setError("");
    try {
      const located = await lookupGeo(requested);
      if (id !== lookupId.current || latestAddress.current !== requested) return;
      onGeoChange(located);
      if (located.lat == null || located.precision === "zip") setShowMap(true);
    } catch (err) {
      if (id === lookupId.current) setError(err?.message || "Location lookup is unavailable right now.");
    } finally {
      if (id === lookupId.current) setLocating(false);
    }
  };

  const pin = useCallback((coords) => {
    lookupId.current += 1;
    setLocating(false);
    onGeoChange(pinnedGeo(address, coords, { by: pinnedBy, previous: geo }));
    setError("");
  }, [address, geo, onGeoChange, pinnedBy]);

  const applyCoords = () => {
    const coords = parseCoordinates(coordsText);
    if (!coords) {
      setError("Paste coordinates like 29.5282, -98.6948 or a Google Maps link to the spot.");
      return;
    }
    pin(coords);
    setCoordsText("");
    setShowMap(true);
  };

  return (
    <div className="space-y-1.5 col-span-2">
      <Label>{label}</Label>
      <Textarea
        placeholder={placeholder}
        value={address}
        onChange={(e) => onAddressChange(e.target.value)}
        onBlur={() => { if (status === "pending" && address.trim()) locate(); }}
        rows={2}
      />
      {address.trim() && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {locating ? (
              <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Locating…</span>
            ) : (
              <LocationStatusBadge status={status} />
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={geo?.matchedAddress || LOCATION_STATUS[status].hint}>
              {status === "pinned" && point
                ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${geo.pinnedBy ? ` · by ${geo.pinnedBy}` : ""}`
                : geo?.matchedAddress && geo.address === address ? `Matched: ${geo.matchedAddress}` : LOCATION_STATUS[status].hint}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={locate} disabled={locating}>
              <Search className="h-3 w-3" /> {status === "pending" ? "Locate" : "Look up again"}
            </Button>
            <Button type="button" size="sm" variant={showMap ? "secondary" : "outline"} className="h-7 gap-1 text-xs" onClick={() => setShowMap(!showMap)}>
              <Crosshair className="h-3 w-3" /> {showMap ? "Hide map" : status === "pinned" ? "Adjust pin" : "Set pin on map"}
            </Button>
            {point && (
              <a href={googleMapsPointUrl(point)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 px-1 text-xs text-sky-600 hover:underline">
                <ExternalLink className="h-3 w-3" /> Check in Google Maps
              </a>
            )}
          </div>
          {showMap && (
            <>
              <Suspense fallback={<div className="flex h-64 items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Loading map…</div>}>
                <LocationPinMap point={point} onPick={pin} approximate={status === "zip"} />
              </Suspense>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Or paste coordinates / a Google Maps link"
                  value={coordsText}
                  onChange={(e) => setCoordsText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCoords(); } }}
                />
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={applyCoords}>
                  <MapPin className="h-3 w-3" /> Use
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
