import {QUOTE_STATUSES} from "../../constants/quoteStatuses.js";

const terminal = new Set(QUOTE_STATUSES.filter(status => status.isTerminal).map(status => status.value));

export function buildQuoteExceptions(timelines, alertRows) {
  const alerts = new Map(alertRows.filter(item => item.alert.level === "red" && !item.alert.isNotification)
    .map(item => [item.quote.id, item.alert]));
  const eligible = timelines.filter(item => item.quote.status !== "on_hold" && !item.quote.exclude_from_reporting);
  const overdue = eligible.filter(item => alerts.has(item.quote.id))
    .map(item => ({...item, reason: `${alerts.get(item.quote.id).name}: ${alerts.get(item.quote.id).timeLabel}`}))
    .sort((a, b) => alerts.get(b.quote.id).hoursInStatus - alerts.get(a.quote.id).hoursInStatus);
  const used = new Set(overdue.map(item => item.quote.id));
  const gaps = eligible.filter(item => !used.has(item.quote.id) && item.issues.length)
    .map(item => ({...item, reason: item.issues.join("; ")}));
  gaps.forEach(item => used.add(item.quote.id));
  const oldest = eligible.filter(item => !used.has(item.quote.id) && !terminal.has(item.quote.status) && item.currentHours !== null)
    .sort((a, b) => b.currentHours - a.currentHours)
    .map(item => ({...item, reason: "Review progress or add a follow-up if needed"}));
  return [
    {key: "overdue", title: "Overdue follow-ups / actions", description: "Existing red quote-alert rules, matching quote cards. These are overdue actions, not scheduled follow-up dates.", rows: overdue},
    {key: "gaps", title: "History gaps to review", description: "Recorded history/date discrepancies; no dates or missing activity are guessed.", rows: gaps},
    {key: "oldest", title: "Oldest open quotes", description: "Longest time in current status first, excluding terminal statuses.", rows: oldest}
  ];
}
