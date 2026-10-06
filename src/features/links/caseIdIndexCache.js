import {useEffect, useState} from "react";
import {getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {buildCaseIdIndex} from "@/lib/externalLinks";

// One app-wide Case Number -> Case ID index built from the Workload report, shared by every
// case-number link on screen (same pattern as careEligibilityCache.js: fetch once, many readers).

let cachedIndex = null;
let inFlight = null;
let lastFetch = 0;
const THROTTLE_MS = 30000;
const subscribers = new Set();

async function fetchIndex() {
  const table = await getReportTable("workload");
  return buildCaseIdIndex(Array.isArray(table?.rows) ? table.rows : []);
}

export function refreshCaseIdIndex({ force = false } = {}) {
  if (!force && cachedIndex && Date.now() - lastFetch < THROTTLE_MS) return Promise.resolve(cachedIndex);
  if (inFlight) return inFlight;
  inFlight = fetchIndex()
    .then((index) => {
      cachedIndex = index;
      lastFetch = Date.now();
      subscribers.forEach((notify) => notify(index));
      return index;
    })
    .catch((error) => {
      console.warn("[case-links] Could not refresh Workload case IDs:", error.message);
      return cachedIndex;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

let stopListening;
function ensureListeners() {
  if (stopListening || typeof window === "undefined") return;
  let refreshTimer;
  const refresh = () => { if (document.visibilityState === "visible") refreshCaseIdIndex(); };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  const off = globalThis.window?.enquoteLocal?.app?.onDataUpdated?.(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshCaseIdIndex({force: true}), 250);
  });
  stopListening = () => {
    clearTimeout(refreshTimer);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
    if (typeof off === "function") off();
    stopListening = null;
  };
}

if (import.meta.hot) import.meta.hot.dispose(() => stopListening?.());

/** Current Map caseNumberKey -> Case ID (null until the first load finishes). */
export function useCaseIdIndex() {
  const [index, setIndex] = useState(cachedIndex);
  useEffect(() => {
    subscribers.add(setIndex);
    ensureListeners();
    if (cachedIndex) setIndex(cachedIndex);
    refreshCaseIdIndex();
    return () => {
      subscribers.delete(setIndex);
      if (!subscribers.size) stopListening?.();
    };
  }, []);
  return index;
}
