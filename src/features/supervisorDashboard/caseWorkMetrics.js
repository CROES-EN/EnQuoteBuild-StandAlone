import {diffDays} from "./dateRanges.js";
import {AGGREGATION_MODES} from "./periodAggregation.js";

export const CASE_HISTORY_COLUMNS = ["Case Number", "Field / Event", "Old Value", "New Value", "Edited By", "Edit Date"];
export const DEFAULT_CASE_WORK_TEAM = [
  "Carsten Roeschberger", "Caitlyn Wilson", "Dusk Davis", "Amir Bermudez",
  "Denice Ankenman", "Virginia Seganos", "Sunshine Frederick", "Mithun Kuriakose",
  "Shane Mosley", "Jennifer Lasley"
];

const text = value => String(value ?? "").trim();
const name = value => text(value).replace(/\s+/g, " ").toLowerCase();

// Salesforce's export is a wall-clock time in the report timezone. UTC here is
// only an ordering coordinate; it must not shift the exported calendar date.
export function parseHistoryDate(value) {
  const raw = text(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
  if (!us && !iso) return null;
  const year = Number(us ? us[3] : iso[1]);
  const month = Number(us ? us[1] : iso[2]);
  const day = Number(us ? us[2] : iso[3]);
  let hour = Number(us ? us[4] || 0 : iso[4] || 0);
  const minute = Number(us ? us[5] || 0 : iso[5] || 0);
  const second = Number(us ? us[6] || 0 : iso[6] || 0);
  if (us?.[7]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (us[7].toUpperCase() === "PM" ? 12 : 0);
  }
  const at = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(at);
  if (year < 1900 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return {at, date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`};
}

export function historyEventKey(row) {
  return JSON.stringify(CASE_HISTORY_COLUMNS.map(column => text(row[column])));
}

export function buildCaseWorkReport(rows, teamNames) {
  const team = new Set(teamNames.map(name).filter(Boolean));
  if (!team.size) throw new Error("Configure at least one case-work team member.");
  const seen = new Set();
  const events = [];
  const invalid = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = historyEventKey(row);
    if (seen.has(key)) {duplicates++; continue;}
    seen.add(key);
    const field = name(row["Field / Event"]);
    if (!["case owner", "owner", "owner (assignment)", "status"].includes(field)) continue;
    const parsed = parseHistoryDate(row["Edit Date"]);
    const event = {key, row, caseNumber: text(row["Case Number"]), siteId: text(row["Enlighten Site ID"]),
      field, oldValue: text(row["Old Value"]), newValue: text(row["New Value"]),
      actor: text(row["Edited By"]), ...(parsed || {})};
    if (!parsed || !event.caseNumber) {invalid.push({...event, reason: "Missing case number or invalid Edit Date"}); continue;}
    events.push(event);
  }
  const owners = new Map();
  for (const event of events.filter(event => event.field !== "status")) {
    if (!owners.has(event.caseNumber)) owners.set(event.caseNumber, new Map());
    const times = owners.get(event.caseNumber);
    if (!times.has(event.at)) times.set(event.at, []);
    times.get(event.at).push(event);
  }
  const timelines = new Map([...owners].map(([caseNumber, times]) =>
    [caseNumber, [...times].sort(([a], [b]) => a - b)]));
  const transfers = [];
  const closures = [];
  const unresolved = [];
  for (const event of events) {
    if (event.field !== "status") {
      if (!event.oldValue || !event.newValue) {
        unresolved.push({...event, reason: "Incomplete owner change"});
      } else if (name(event.oldValue) !== name(event.newValue) && team.has(name(event.oldValue)) && !team.has(name(event.newValue))) {
        transfers.push({...event, reason: "Transfer from team to outside owner or queue", owner: event.oldValue});
      }
      continue;
    }
    if (name(event.newValue) !== "closed" || !event.oldValue || name(event.oldValue) === "closed") continue;
    const timeline = timelines.get(event.caseNumber) || [];
    let before;
    let after;
    let simultaneous = false;
    for (const [at, changes] of timeline) {
      if (at < event.at) before = changes;
      else if (at === event.at) simultaneous = true;
      else {after = changes; break;}
    }
    const anchors = new Set([
      ...(before || []).map(change => name(change.newValue)),
      ...(after || []).map(change => name(change.oldValue))
    ]);
    if (simultaneous || anchors.size !== 1 || anchors.has("")) {
      unresolved.push({...event, reason: simultaneous ? "Owner change at the same timestamp; order unknown" :
        anchors.size === 0 ? "No historical ownership anchor" : "Conflicting or incomplete ownership anchors"});
    } else {
      const owner = [...anchors][0];
      if (team.has(owner)) closures.push({...event, owner, reason: "Open-to-Closed with history-supported team ownership"});
    }
  }
  const dates = events.map(event => event.date).sort();
  return {transfers, closures, unresolved, invalid, duplicates,
    firstDate: dates[0] || null, lastDate: dates.at(-1) || null};
}

export function caseWorkDisplay(report, metric, range, mode = AGGREGATION_MODES.PERIOD_TOTAL) {
  const source = metric === "transfers" ? report.transfers : metric === "closed" ? report.closures :
    metric === "unresolved" ? report.unresolved : [...report.transfers, ...report.closures];
  const rows = source.filter(event => event.date >= range.start && event.date <= range.end &&
    (mode !== AGGREGATION_MODES.LATEST_DAY || event.date === range.end));
  const identity = event => metric === "events" ? `${event.caseNumber}:${event.at}` :
    metric === "sites" ? event.siteId : event.caseNumber;
  const count = records => new Set(records.map(identity).filter(Boolean)).size;
  let value = count(rows);
  if (mode === AGGREGATION_MODES.DAILY_AVERAGE) {
    const days = diffDays(range.start, range.end) + 1;
    if (!(days > 0)) throw new Error("Case-work daily average requires a valid reporting period.");
    const byDay = new Map();
    for (const event of rows) {
      if (!byDay.has(event.date)) byDay.set(event.date, []);
      byDay.get(event.date).push(event);
    }
    value = [...byDay.values()].reduce((sum, records) => sum + count(records), 0) / days;
  }
  return {value, rows, missingSites: rows.filter(event => !event.siteId).length};
}
