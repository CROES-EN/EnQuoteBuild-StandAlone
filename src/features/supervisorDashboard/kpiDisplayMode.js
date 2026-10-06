import {addDays, diffDays, filterRecordsInRange, toDateStr} from "./dateRanges.js";
import {aggregateMetric, AGGREGATION_MODES} from "./periodAggregation.js";

export function displayModeRecords(records, range, mode) {
  const ranged = filterRecordsInRange(records, range);
  if (mode !== AGGREGATION_MODES.LATEST_DAY || !ranged.length) return ranged;
  const latest = ranged[ranged.length - 1].date;
  return ranged.filter(record => record.date === latest);
}

export function displayCount(records, mode) {
  return aggregateMetric(records, mode, {additive: true})?.value ?? null;
}

export function dailyCountValue(total, records, mode) {
  if (total === null || total === undefined) return null;
  const days = new Set(records.map(record => record.date)).size;
  return mode === AGGREGATION_MODES.DAILY_AVERAGE && days ? total / days : total;
}

export function quoteDisplayMetric(report, metric, range, mode) {
  const events = report.activity.filter(event => metric === "created" ? event.kind === "created" : ["transition", "follow_up"].includes(event.kind));
  const date = range.end;
  const contributing = mode === AGGREGATION_MODES.LATEST_DAY
    ? events.filter(event => toDateStr(new Date(event.at)) === date) : events;
  if (mode !== AGGREGATION_MODES.DAILY_AVERAGE) {
    return {value: new Set(contributing.map(event => event.quote.id)).size, activity: contributing, date: mode === AGGREGATION_MODES.LATEST_DAY ? date : null};
  }
  const days = diffDays(range.start, range.end) + 1;
  if (!Number.isFinite(days) || days <= 0) throw new Error("Quote daily average requires a valid reporting period.");
  const byDay = new Map();
  for (const event of contributing) {
    const day = toDateStr(new Date(event.at));
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(event.quote.id);
  }
  let total = 0;
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) total += byDay.get(day)?.size || 0;
  return {value: total / days, activity: contributing, date: null};
}
