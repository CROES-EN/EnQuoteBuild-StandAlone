import {useEffect, useState} from "react";
import {getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {buildCareEligibilityIndex} from "@/features/supervisorDashboard/careEligibility";

/**
 * Shared, cross-component cache for the Care eligibility index, fetched ONCE per app
 * session (not once per tile/card) and reused by every consumer via useCareEligibilityIndex()
 * below.
 *
 * WHY THIS EXISTS: this app has a real, previously-confirmed OOM crash root cause (see
 * AutoDrafterCaseTile.jsx's own header comment) caused by ~100+ simultaneously-mounted
 * tiles EACH independently fetching/parsing the full shared local data file on mount.
 * QuoteCard.jsx and AutoDrafterCaseTile.jsx can both render in grids of many tiles at
 * once, so a naive "each tile fetches its own care_subscriptions data" implementation
 * here would risk reintroducing that exact same failure mode. Instead, this module
 * fetches ONCE, caches the result at module scope (survives across every mounted
 * consumer, not per-component), and notifies all currently-mounted subscribers when a
 * background refresh completes - so 500 tiles on screen still only ever trigger ONE
 * underlying getReportTable() call, not 500.
 */

let cachedIndex = null;
let inFlightPromise = null;
let lastFetchTime = 0;
const REFRESH_THROTTLE_MS = 5000;
const subscribers = new Set();

async function fetchIndex() {
  const table = await getReportTable("care_subscriptions");
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return buildCareEligibilityIndex(rows);
}

function notifySubscribers() {
  subscribers.forEach((setIndex) => setIndex(cachedIndex));
}

function refreshIndex({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedIndex && now - lastFetchTime < REFRESH_THROTTLE_MS) return Promise.resolve(cachedIndex);
  if (inFlightPromise) return inFlightPromise;
  inFlightPromise = fetchIndex()
    .then((index) => {
      cachedIndex = index;
      lastFetchTime = Date.now();
      notifySubscribers();
      return index;
    })
    .catch(() => {
      // Keep whatever was last cached (even if stale) rather than clearing it on a
      // transient read failure - a temporarily-unreadable data file should not make
      // every Care shield on screen disappear.
      return cachedIndex;
    })
    .finally(() => {
      inFlightPromise = null;
    });
  return inFlightPromise;
}

// Registered exactly ONCE globally (not once per hook instance/component mount) - every
// component using this hook shares the same background-refresh trigger.
let globalListenersRegistered = false;
function ensureGlobalListeners() {
  if (globalListenersRegistered) return;
  globalListenersRegistered = true;
  function handleVisibility() {
    if (document.visibilityState === "visible") refreshIndex();
  }
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", handleVisibility);
}

/**
 * Returns the current cached Care eligibility index (a Map, see
 * careEligibility.js's buildCareEligibilityIndex), or null while the very first
 * app-wide fetch is still in flight. Safe to call from any number of simultaneously
 * mounted components - the underlying fetch itself only ever happens once at a time,
 * shared across all of them.
 */
export function useCareEligibilityIndex() {
  const [index, setIndex] = useState(cachedIndex);

  useEffect(() => {
    ensureGlobalListeners();
    subscribers.add(setIndex);
    if (!cachedIndex) {
      refreshIndex();
    } else {
      setIndex(cachedIndex);
    }
    return () => {
      subscribers.delete(setIndex);
    };
  }, []);

  return index;
}