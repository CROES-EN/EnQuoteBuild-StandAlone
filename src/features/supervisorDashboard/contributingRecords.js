import {parseIncortaRawDate} from "./callVolumeRawOverrides.js";
import {filterRecordsInRange} from "./dateRanges.js";

export function quoteContributingRecords(report, metric) {
  const grouped = new Map();
  for (const event of report.activity) {
    if (metric === "created" ? event.kind !== "created" : !["transition", "follow_up"].includes(event.kind)) continue;
    if (!grouped.has(event.quote.id)) grouped.set(event.quote.id, {quote: event.quote, events: []});
    grouped.get(event.quote.id).events.push(event);
  }
  return [...grouped.values()];
}

export function niceCallContributingRecords(rows, range) {
  const records = [];
  let undated = 0;
  for (const [index, row] of rows.entries()) {
    const date = parseIncortaRawDate(row["Contact Start Time (PST)"]);
    if (!date) { undated++; continue; }
    const abandoned = String(row.Abandons ?? "").trim() === "1";
    const handled = String(row.Handled ?? "").trim() === "1";
    records.push({
      id: index, date, row,
      outcome: abandoned ? "Abandoned" : handled ? "Handled" : "Unclassified"
    });
  }
  return {records: filterRecordsInRange(records, range), undated};
}
