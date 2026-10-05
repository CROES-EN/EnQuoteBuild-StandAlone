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
    .catch(() => cachedIndex)
    .finally(() => { inFlight = null; });
  return inFlight;
}

let listening = false;
function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const refresh = () => { if (document.visibilityState === "visible") refreshCaseIdIndex(); };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  globalThis.window?.enquoteLocal?.app?.onDataUpdated?.(() => refreshCaseIdIndex({ force: true }));
}

/** Current Map caseNumberKey -> Case ID (null until the first load finishes). */
export function useCaseIdIndex() {
  const [index, setIndex] = useState(cachedIndex);
  useEffect(() => {
    ensureListeners();
    subscribers.add(setIndex);
    if (cachedIndex) setIndex(cachedIndex);
    else refreshCaseIdIndex();
    return () => { subscribers.delete(setIndex); };
  }, []);
  return index;
}
