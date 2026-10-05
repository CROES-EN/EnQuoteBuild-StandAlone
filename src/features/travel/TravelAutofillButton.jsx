import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {Route, Loader2} from "lucide-react";
import {updateLocalRecord} from "@/api/dataClient";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {formatDuration} from "@/lib/routing";
import {useFstRoster} from "@/lib/useFstRoster";
import {rankFsts} from "./rankFsts";

const TRAVEL_RATE = 65;
const MILEAGE_RATE = 0.73;

function clampFstCount(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, n));
}

function roundTravelHours(minutes) {
  return Math.round((minutes / 60) * 4) / 4;
}

export default function TravelAutofillButton({ quote, onApply }) {
  const { activeFSTs, isLoading, afterRosterWrite } = useFstRoster({ pollMs: 0 });
  const [open, setOpen] = useState(false);
  const [siteAddress, setSiteAddress] = useState(quote?.site_address || quote?.address || "");
  const [startFrom, setStartFrom] = useState("home");
  const [fstCount, setFstCount] = useState(clampFstCount(quote?.fst_count || 1));
  const [isFinding, setIsFinding] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    setSiteAddress(quote?.site_address || quote?.address || "");
    setFstCount(clampFstCount(quote?.fst_count || 1));
    setRankings([]);
    setSelectedIds(new Set());
    setError(null);
    setProgress("");
  }, [open, quote?.site_address, quote?.address, quote?.fst_count]);

  const visibleRankings = rankings.slice(0, 10);
  const selected = useMemo(
    () => visibleRankings.filter((r) => selectedIds.has(r.fst.id)),
    [visibleRankings, selectedIds]
  );
  const exactHours = selected.reduce((sum, r) => sum + r.roundTrip.minutes / 60, 0);
  const roundedHours = roundTravelHours(selected.reduce((sum, r) => sum + r.roundTrip.minutes, 0));
  const totalMiles = Math.ceil(selected.reduce((sum, r) => sum + r.roundTrip.miles, 0));
  const travelCharge = roundedHours * TRAVEL_RATE;
  const mileageCharge = totalMiles * MILEAGE_RATE;

  const handleFind = async () => {
    setError(null);
    setRankings([]);
    setSelectedIds(new Set());
    if (!siteAddress.trim()) {
      setError("Enter a site address first.");
      return;
    }
    if (!activeFSTs.length) {
      setError("No active FSTs in the roster. Please add FSTs first.");
      return;
    }

    setIsFinding(true);
    try {
      const ranked = await rankFsts({
        address: siteAddress,
        startFrom,
        activeFSTs,
        onProgress: setProgress,
        persistGeo: (fst, field, geo) => updateLocalRecord("fsts", fst.id, { [field]: geo })
      });
      afterRosterWrite();
      const list = ranked.results.slice(0, 10);
      setRankings(list);
      setSelectedIds(new Set(list.slice(0, clampFstCount(fstCount)).map((r) => r.fst.id)));
      if (list.some((r) => r.routeApproximate)) {
        toast.warning("Some routes were estimated from straight-line distance because road routing was unreachable.");
      }
    } catch (err) {
      setError(err?.message || "Could not rank FSTs.");
    } finally {
      setIsFinding(false);
      setProgress("");
    }
  };

  const toggleSelected = (id, checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleApply = () => {
    if (selected.length === 0) return;
    onApply?.({ travel_hours: roundedHours, miles_traveled: totalMiles, fst_count: selected.length });
    if (Number(quote?.fst_count || 0) !== selected.length) {
      toast.info(`Applied travel for ${selected.length} selected FST${selected.length === 1 ? "" : "s"}; FST count was updated.`);
    } else {
      toast.success("Travel totals applied to quote.");
    }
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-sky-300 bg-card text-sky-700 hover:bg-sky-50"
      >
        <Route className="w-4 h-4 mr-2" />
        Fill travel
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fill travel</DialogTitle>
            <DialogDescription>
              Rank active FSTs by round-trip drive time and apply combined travel to this quote.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="travel-site-address">Site address</Label>
              <Input
                id="travel-site-address"
                value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)}
                placeholder="123 Main St, Denver, CO 80202"
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Start FSTs from</Label>
                <div className="flex gap-2">
                  {[["home", "Home"], ["shipping", "Shipping (U-Haul)"]].map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={startFrom === value ? "default" : "outline"}
                      className={startFrom === value ? "bg-sky-600 hover:bg-sky-700" : ""}
                      onClick={() => setStartFrom(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2 w-36">
                <Label htmlFor="travel-fst-count">Number of FSTs</Label>
                <Input
                  id="travel-fst-count"
                  type="number"
                  min="1"
                  max="10"
                  value={fstCount}
                  onChange={(e) => setFstCount(clampFstCount(e.target.value))}
                />
              </div>
              <Button
                type="button"
                onClick={handleFind}
                disabled={isFinding || isLoading || !siteAddress.trim()}
                className="bg-sky-600 hover:bg-sky-700"
              >
                {isFinding ? <><Loader2 className="w-4 h-4 animate-spin" /> Finding...</> : "Find FSTs"}
              </Button>
            </div>

            {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
            {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

            {visibleRankings.length > 0 && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {visibleRankings.map((r) => (
                    <label key={r.fst.id} className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40">
                      <Checkbox
                        checked={selectedIds.has(r.fst.id)}
                        onCheckedChange={(checked) => toggleSelected(r.fst.id, checked === true)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{r.fst.name}</span>
                          {r.originCityState && <span className="text-xs text-muted-foreground">{r.originCityState}</span>}
                          {r.zipApproximate && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Approximate – ZIP only</Badge>}
                          {r.routeApproximate && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Straight-line estimate</Badge>}
                        </div>
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-1 text-xs text-muted-foreground">
                          <span>Round trip: <strong className="text-foreground">{(r.roundTrip.minutes / 60).toFixed(2)} h</strong> / {r.roundTrip.miles.toFixed(1)} mi</span>
                          <span>One-way: <strong className="text-foreground">{formatDuration(r.oneWay.minutes)}</strong></span>
                          <span>From: {r.originAddress}</span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                  <p className="font-semibold">Selected travel totals</p>
                  <p>Exact travel hours: {exactHours.toFixed(2)} h; quote travel hours: {roundedHours.toFixed(2)} h (nearest 0.25 h)</p>
                  <p>Miles: {totalMiles} mi (rounded up)</p>
                  <p>Charges: ${travelCharge.toFixed(2)} travel + ${mileageCharge.toFixed(2)} mileage</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleApply} disabled={selected.length === 0}>Apply to quote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
