import {scopedKey} from "../../lib/userScopedStorage.js";
import {RANGE_PRESETS} from "./dateRanges.js";

export const HOURLY_PRESETS = {
  LAST_7: "last7",
  LAST_14: "last14",
  LAST_30: "last30",
  SINGLE_DAY: "singleDay",
  ALL: "all",
  CUSTOM: "custom"
};

export const DEFAULT_HOURLY_PERIOD = {
  preset: HOURLY_PRESETS.LAST_7,
  customStart: "",
  customEnd: "",
  selectedDay: ""
};

const KEYS = {
  overview: "enquote_supervisor_overview_period_v1",
  hourly: "enquote_supervisor_hourly_period_v1"
};

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidReportingPeriod(scope, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (scope === "overview") {
    return Object.values(RANGE_PRESETS).includes(value.preset)
      && isDate(value.start) && isDate(value.end) && value.start <= value.end;
  }
  return Object.values(HOURLY_PRESETS).includes(value.preset)
    && ["customStart", "customEnd", "selectedDay"].every(key => value[key] === "" || isDate(value[key]));
}

function storageKey(scope) {
  if (!Object.hasOwn(KEYS, scope)) throw new Error(`Unknown reporting period scope: ${scope}`);
  return scopedKey(KEYS[scope]);
}

/** Restores each control independently, including its explicit dates; never shares users' selections. */
export function readReportingPeriod(scope) {
  const key = storageKey(scope);
  const fallback = scope === "overview" ? null : {...DEFAULT_HOURLY_PERIOD};
  try {
    const raw = globalThis.window?.localStorage?.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!isValidReportingPeriod(scope, value)) throw new Error("Invalid saved reporting period");
    return value;
  } catch (error) {
    console.warn("Unable to restore supervisor reporting period", scope, error);
    return fallback;
  }
}

export function saveReportingPeriod(scope, value) {
  const key = storageKey(scope);
  if (!isValidReportingPeriod(scope, value)) throw new Error("Invalid reporting period");
  try {
    const storage = globalThis.window?.localStorage;
    if (!storage) throw new Error("Local storage is unavailable");
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("Unable to save supervisor reporting period", scope, error);
    return false;
  }
}
