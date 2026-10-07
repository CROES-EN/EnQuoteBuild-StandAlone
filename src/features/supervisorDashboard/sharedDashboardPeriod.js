import {isValidReportingPeriod} from "./reportingPeriodPreferences.js";
import {AGGREGATION_MODES} from "./periodAggregation.js";

export const SHARED_PERIOD_QUERY = "enquoteReportPeriod";
export const SHARED_TILE_QUERY = "enquoteReportTile";

export function readSharedDashboardPeriod(params) {
  const raw = params.get(SHARED_PERIOD_QUERY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!isValidReportingPeriod("overview", value?.range) ||
      !Object.values(AGGREGATION_MODES).includes(value?.mode)) {
    throw new Error("This dashboard link has an invalid reporting period.");
  }
  return value;
}

export function sharedDashboardTilePath(tileId, range, mode) {
  const params = new URLSearchParams({tab: "dashboard"});
  params.set(SHARED_PERIOD_QUERY, JSON.stringify({range, mode}));
  readSharedDashboardPeriod(params);
  params.set(SHARED_TILE_QUERY, tileId);
  return `/SupervisorDashboard?${params}`;
}
