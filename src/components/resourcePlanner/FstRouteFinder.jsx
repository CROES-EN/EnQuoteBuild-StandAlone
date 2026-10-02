import {useEffect, useRef, useState} from "react";
import {updateLocalRecord} from "@/api/dataClient";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Clock, ExternalLink, Loader2, Mail, MapPin, Navigation, Phone, Trophy} from "lucide-react";
import {useFstRoster} from "@/lib/useFstRoster";
import {
  drivingMatrix,
  formatDuration,
  geocodeAddress,
  googleMapsDirectionsUrl,
  stateFromAddress,
  straightLineMiles
} from "@/lib/routing";

const MAX_ROUTED_CANDIDATES = 25;
// An in-state FST counts as "close" within this straight-line distance of the site;
// otherwise the search widens to the nearest FSTs in any state.
export const CLOSE_MILES = 150;
const VISIBLE_RESULTS = 10;

// Picks the address (and which cached-coordinates field belongs to it) to route from.
const pickOrigin = (fst, startFrom) => {
  const home = { address: fst.home_address || "", field: "home_geo" };
  const ship = { address: fst.shipping_address || "", field: "ship_geo" };
  const [first, second] = startFrom === "shipping" ? [ship, home] : [home, ship];
  return first.address ? first : second;
};

// State of the FST's routing origin: from the address text, else the roster's state fields.
const originState = (fst, origin) => {
  const fallback = origin.field === "home_geo" ? fst.home_state || fst.state : fst.state || fst.home_state;
  const code = String(fallback || "").trim().toUpperCase();
  return stateFromAddress(origin.address) || (/^[A-Z]{2}$/.test(code) ? code : "");
};

// Finds and ranks the nearest FSTs to a site address. Used by the Resource Planner tab and
// embeddable anywhere else (e.g. a quote's detail screen): pass initialAddress to prefill
// the search box, and autoSearch to run it as soon as the roster is loaded.
export default function FstRouteFinder({ initialAddress = "", autoSearch = false }) {
  const { activeFSTs, isLoading: fstsLoading, afterRosterWrite } = useFstRoster({ pollMs: 0 });

  const [svAddress, setSvAddress] = useState(initialAddress);
  const [startFrom, setStartFrom] = useState("home");
  const [rankings, setRankings] = useState(null);
  const [rankedAddress, setRankedAddress] = useState("");
  const [skippedCount, setSkippedCount] = useState(0);
  const [searchScope, setSearchScope] = useState(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [isRanking, setIsRanking] = useState(false);
  const [rankProgress, setRankProgress] = useState("");
  const [rankError, setRankError] = useState(null);

  // Returns cached coordinates for the FST's origin address, geocoding (and caching on
  // the record) only when the address is new or has changed since the last lookup.
  // If the preferred address can't be located, the FST's other address is tried.
  const locateFST = async (fst) => {
    const preferred = pickOrigin(fst, startFrom);
    const alternate = preferred.field === "home_geo"
      ? { address: fst.shipping_address || "", field: "ship_geo" }
      : { address: fst.home_address || "", field: "home_geo" };

    for (const { address, field } of [preferred, alternate]) {
      if (!address) continue;
      const cached = fst[field];
      if (cached && cached.address === address) {
        if (cached.lat != null) return { ...cached, address };
        continue;
      }
      const point = await geocodeAddress(address);
      await updateLocalRecord("fsts", fst.id, { [field]: { address, lat: point?.lat ?? null, lng: point?.lng ?? null } });
      if (point) return { ...point, address };
    }
    return null;
  };

  const handleRank = async () => {
    const target = svAddress.trim();
    if (!target) return;
    if (activeFSTs.length === 0) {
      setRankError("No active FSTs in the roster. Please add FSTs first.");
      return;
    }
    setIsRanking(true);
    setRankings(null);
    setRankError(null);
    setShowAllResults(false);
    try {
      setRankProgress("Locating site visit address...");
      const targetPoint = await geocodeAddress(target);
      if (!targetPoint) {
        setRankError("Couldn't find that address. Check the street, city and ZIP and try again.");
        return;
      }

      const siteState = stateFromAddress(target) || targetPoint.state || "";
      const entries = activeFSTs.map((fst) => ({ fst, state: originState(fst, pickOrigin(fst, startFrom)) }));
      const sameState = siteState ? entries.filter((e) => e.state === siteState) : entries;
      const otherStates = siteState ? entries.filter((e) => e.state !== siteState) : [];

      const located = [];
      let skipped = 0;
      let done = 0;
      const locateAll = async (list) => {
        for (const entry of list) {
          done += 1;
          const origin = pickOrigin(entry.fst, startFrom);
          if (origin.address && !(entry.fst[origin.field]?.address === origin.address)) {
            setRankProgress(`Locating FST addresses (${done}/${activeFSTs.length}) - first run only, results are saved...`);
          }
          const point = await locateFST(entry.fst);
          if (point) located.push({ ...entry, point, straight: straightLineMiles(targetPoint, point) });
          else skipped += 1;
        }
      };

      // Same-state FSTs first; other states are only looked up when nothing in-state is close.
      await locateAll(sameState);
      let widened = false;
      if (siteState && !located.some((e) => e.straight <= CLOSE_MILES)) {
        widened = true;
        await locateAll(otherStates);
      }
      afterRosterWrite();

      if (located.length === 0) {
        setRankError("None of the FSTs have an address that could be located. Check the roster addresses.");
        return;
      }

      setRankProgress("Calculating drive times...");
      const candidates = located
        .sort((a, b) => a.straight - b.straight)
        .slice(0, MAX_ROUTED_CANDIDATES);

      let drives = candidates.map(() => null);
      try {
        drives = await drivingMatrix(targetPoint, candidates.map((c) => c.point));
      } catch {
        // Routing service unreachable: fall back to straight-line distances below.
      }

      const results = candidates.map((c, i) => ({
        fst: c.fst,
        inState: Boolean(siteState) && c.state === siteState,
        originAddress: c.point.address,
        miles: drives[i]?.miles ?? c.straight,
        minutes: drives[i]?.minutes ?? null,
        approximate: !drives[i]
      })).sort((a, b) => {
        if (a.approximate !== b.approximate) return a.approximate ? 1 : -1;
        return a.approximate ? a.miles - b.miles : a.minutes - b.minutes;
      });

      setRankedAddress(target);
      setSkippedCount(skipped);
      setSearchScope({ state: siteState, widened });
      setRankings(results);
    } catch (err) {
      setRankError(`Failed to rank FSTs: ${err?.message || "please try again."}`);
    } finally {
      setIsRanking(false);
      setRankProgress("");
    }
  };

  const rankColor = (index) => {
    if (index === 0) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (index === 1) return "bg-sky-100 text-sky-700 border-sky-200";
    if (index === 2) return "bg-violet-100 text-violet-700 border-violet-200";
    return "bg-muted text-muted-foreground border-border";
  };

  const autoSearched = useRef(false);
  useEffect(() => {
    if (!autoSearch || autoSearched.current || fstsLoading || !initialAddress.trim()) return;
    autoSearched.current = true;
    handleRank();
  }, [autoSearch, fstsLoading]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-sky-600" />
            Enter Site Visit Address
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Input
              placeholder="e.g. 123 Main St, Denver, CO 80202"
              value={svAddress}
              onChange={(e) => setSvAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRank()}
              className="flex-1"
            />
            <Button
              onClick={handleRank}
              disabled={isRanking || !svAddress.trim()}
              className="bg-sky-600 hover:bg-sky-700 gap-2 shrink-0"
            >
              {isRanking ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Routing...</>
              ) : (
                <><Navigation className="w-4 h-4" /> Find Best FST</>
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Measure from FST&apos;s:</span>
            {[["home", "Home address"], ["shipping", "Shipping address"]].map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={startFrom === value ? "default" : "outline"}
                className={startFrom === value ? "bg-sky-600 hover:bg-sky-700 h-7" : "h-7"}
                onClick={() => setStartFrom(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {activeFSTs.length === 0 && !fstsLoading && (
            <p className="text-sm text-amber-600 flex items-center gap-1">
              No active FSTs in roster. Add FSTs in the <strong>FST Roster</strong> tab first.
            </p>
          )}
          {activeFSTs.length > 0 && (
            <p className="text-xs text-muted-foreground">{activeFSTs.length} active FST{activeFSTs.length !== 1 ? "s" : ""} will be evaluated</p>
          )}
        </CardContent>
      </Card>

      {rankError && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="pt-4 pb-4 text-sm text-rose-700">{rankError}</CardContent>
        </Card>
      )}

      {isRanking && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-sky-500" />
            <p className="font-medium">Calculating routes...</p>
            <p className="text-sm text-muted-foreground mt-1">{rankProgress}</p>
          </CardContent>
        </Card>
      )}

      {rankings && rankings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span>Ranked by drive time for: <strong className="text-foreground">{rankedAddress}</strong></span>
          </div>
          {searchScope?.state && (
            <p className={`text-xs ${searchScope.widened ? "text-amber-600" : "text-muted-foreground"}`}>
              {searchScope.widened
                ? `No FST within ${CLOSE_MILES} miles in ${searchScope.state}, so the nearest FSTs in any state are shown.`
                : `Showing ${searchScope.state} FSTs only.`}
            </p>
          )}
          {(showAllResults ? rankings : rankings.slice(0, VISIBLE_RESULTS)).map((r, index) => (
            <Card key={r.fst.id} className={`border ${index === 0 ? "border-emerald-200 shadow-emerald-50 shadow-md" : "border-border"}`}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border ${rankColor(index)} shrink-0 mt-0.5`}>
                    #{index + 1}
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground text-base">{r.fst.name}</span>
                      {index === 0 && (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Best Match</Badge>
                      )}
                      {r.fst.region && <Badge variant="outline" className="text-xs">{r.fst.region}</Badge>}
                      {searchScope?.widened && !r.inState && <Badge variant="outline" className="text-xs text-sky-700 border-sky-300">Out of state</Badge>}
                      {r.approximate && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Straight-line estimate</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>From: {r.originAddress}</span>
                    </p>
                    {r.fst.shipping_address && (
                      <p className="text-xs text-muted-foreground flex items-start gap-1">
                        <Navigation className="w-3 h-3 shrink-0 mt-0.5" />
                        <span><span className="font-medium text-foreground">Ship materials to:</span> {r.fst.shipping_address}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-xs text-muted-foreground">
                      {r.fst.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.fst.phone}</span>}
                      {r.fst.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{r.fst.email}</span>}
                      {r.fst.supervisor && <span>Sup: {r.fst.supervisor}</span>}
                    </div>
                    <a
                      href={googleMapsDirectionsUrl(r.originAddress, rankedAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline pt-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Open route in Google Maps
                    </a>
                  </div>
                  <div className="shrink-0 text-right space-y-2">
                    <div className="flex gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">{r.approximate ? "Straight-line" : "Distance"}</p>
                        <p className="font-bold text-foreground">{r.miles.toFixed(1)} mi</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Drive Time</p>
                        <p className="font-bold text-foreground flex items-center gap-1 justify-end">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {formatDuration(r.minutes)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 border-t border-border pt-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Round Trip</p>
                        <p className="font-semibold text-foreground">{(r.miles * 2).toFixed(1)} mi</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Round Trip Time</p>
                        <p className="font-semibold text-foreground flex items-center gap-1 justify-end">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {formatDuration(r.minutes == null ? null : r.minutes * 2)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {rankings.length > VISIBLE_RESULTS && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={() => setShowAllResults(!showAllResults)}>
                {showAllResults ? "Show fewer" : `Show all ${rankings.length}`}
              </Button>
            </div>
          )}
          {skippedCount > 0 && (
            <p className="text-xs text-amber-600 text-center">
              {skippedCount} active FST{skippedCount !== 1 ? "s were" : " was"} skipped because no address was on file or it couldn&apos;t be located.
            </p>
          )}
          <p className="text-xs text-muted-foreground text-center pt-1">
            Drive times come from OpenStreetMap routing and don&apos;t include live traffic. Use the Google Maps link for current conditions.
          </p>
        </div>
      )}
    </div>
  );
}
