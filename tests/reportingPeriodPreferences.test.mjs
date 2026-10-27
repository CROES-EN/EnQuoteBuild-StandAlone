import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOURLY_PERIOD,
  hourlyComparisonDates,
  readReportingPeriod,
  saveReportingPeriod
} from "../src/features/supervisorDashboard/reportingPeriodPreferences.js";

test("two-day comparisons select Monday and Friday without including the weekend", () => {
  const dates = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"];
  assert.deepEqual(hourlyComparisonDates(dates, "2026-10-26", "2026-10-23"), ["2026-10-23", "2026-10-26"]);
  assert.deepEqual(hourlyComparisonDates(dates, "", ""), ["2026-10-25", "2026-10-26"]);
  assert.deepEqual(hourlyComparisonDates(dates, "2026-10-26", "2026-10-26"), ["2026-10-25", "2026-10-26"]);
  assert.deepEqual(hourlyComparisonDates(["2026-10-26"], "", ""), ["2026-10-26"]);
  assert.deepEqual(hourlyComparisonDates([], "", ""), []);
});

test("reporting periods survive remounts, remain independent, and are scoped to users", () => {
  const data = new Map();
  globalThis.window = {localStorage: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  }};
  try {
    window.localStorage.setItem("enquote_local_session_email", "first@example.com");
    assert.equal(readReportingPeriod("overview"), null);
    assert.deepEqual(readReportingPeriod("hourly"), DEFAULT_HOURLY_PERIOD);
    const overview = {preset: "custom_range", start: "2026-10-01", end: "2026-10-05"};
    const hourly = {...DEFAULT_HOURLY_PERIOD, preset: "singleDay", selectedDay: "2026-10-04"};
    assert.equal(saveReportingPeriod("overview", overview), true);
    assert.equal(saveReportingPeriod("hourly", hourly), true);
    assert.deepEqual(readReportingPeriod("overview"), overview);
    assert.deepEqual(readReportingPeriod("hourly"), hourly);
    window.localStorage.setItem("enquote_local_session_email", "second@example.com");
    assert.equal(readReportingPeriod("overview"), null);
    assert.deepEqual(readReportingPeriod("hourly"), DEFAULT_HOURLY_PERIOD);
    window.localStorage.setItem("enquote_local_session_email", "first@example.com");
    assert.deepEqual(readReportingPeriod("overview"), overview);
    const custom = {...hourly, preset: "custom", customStart: "2026-10-01", customEnd: "2026-10-03"};
    saveReportingPeriod("hourly", custom);
    assert.deepEqual(readReportingPeriod("hourly"), custom);
    const comparison = {...custom, preset: "compareDays", selectedDay: "2026-10-26", comparisonDay: "2026-10-23"};
    saveReportingPeriod("hourly", comparison);
    assert.deepEqual(readReportingPeriod("hourly"), comparison);
    saveReportingPeriod("overview", {preset: "last_30_days", start: "2026-09-07", end: "2026-10-06"});
    assert.equal(readReportingPeriod("overview").preset, "last_30_days");
    assert.deepEqual(readReportingPeriod("hourly"), comparison);
  } finally {
    delete globalThis.window;
  }
});

test("invalid storage is reported and safely defaults; write failures are reported", () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    for (const raw of ["{", JSON.stringify({preset: "unknown"}), JSON.stringify({
      preset: "single_day", start: "2026-02-30", end: "2026-02-30"
    })]) {
      globalThis.window = {localStorage: {getItem: key => key.includes("period") ? raw : null}};
      assert.equal(readReportingPeriod("overview"), null);
    }
    globalThis.window = {localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error("Storage full"); }
    }};
    assert.equal(saveReportingPeriod("hourly", DEFAULT_HOURLY_PERIOD), false);
    assert.equal(warnings.length, 4);
    assert.throws(() => saveReportingPeriod("overview", {preset: "all_history", start: "2026-10-06", end: "2026-10-01"}));
    assert.throws(() => readReportingPeriod("unknown"));
  } finally {
    console.warn = warn;
    delete globalThis.window;
  }
});
