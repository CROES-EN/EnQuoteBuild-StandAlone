import {addDays, diffDays, toDateStr} from "../supervisorDashboard/dateRanges.js";
import {statusLabel} from "./quoteLifecycle.js";

export function activityChartData(daily, range) {
  const start = range.start || daily[0]?.date;
  const end = range.end || daily[daily.length - 1]?.date;
  if (!start || !end) return {data: [], interval: "daily"};
  const days = diffDays(start, end);
  const interval = days > 365 ? "monthly" : days > 90 ? "weekly" : "daily";
  const buckets = new Map();
  function keyFor(date) {
    if (interval === "monthly") return date.slice(0, 7);
    if (interval === "weekly") return addDays(start, Math.floor(diffDays(start, date) / 7) * 7);
    return date;
  }
  if (interval === "monthly") {
    const cursor = new Date(`${start}T12:00:00`);
    cursor.setDate(1);
    while (toDateStr(cursor).slice(0, 7) <= end.slice(0, 7)) {
      const date = toDateStr(cursor).slice(0, 7);
      buckets.set(date, {date, created: 0, transitions: 0});
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    for (let date = start; date <= end; date = addDays(date, interval === "weekly" ? 7 : 1)) {
      buckets.set(date, {date, created: 0, transitions: 0});
    }
  }
  for (const day of daily) {
    if (day.date < start || day.date > end) continue;
    const bucket = buckets.get(keyFor(day.date));
    bucket.created += day.created;
    bucket.transitions += day.transitions;
  }
  return {data: [...buckets.values()], interval};
}

export function agingChartData(timelines) {
  const rows = [
    {name: "Under 1 day", count: 0}, {name: "1-3 days", count: 0},
    {name: "3-7 days", count: 0}, {name: "7-14 days", count: 0},
    {name: "14+ days", count: 0}, {name: "Unknown", count: 0}
  ];
  for (const {currentHours: hours} of timelines) {
    const index = hours === null ? 5 : hours < 24 ? 0 : hours < 72 ? 1 : hours < 168 ? 2 : hours < 336 ? 3 : 4;
    rows[index].count++;
  }
  return rows;
}

export function turnaroundChartData(durations) {
  return durations.map(row => ({
    ...row, name: `${statusLabel(row.from)} → ${statusLabel(row.to)}`,
    averageDays: row.average / 24, medianDays: row.median / 24, longestDays: row.longest / 24
  }));
}
