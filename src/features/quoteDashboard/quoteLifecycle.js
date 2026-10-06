import {getStatusLabel} from "../../constants/quoteStatuses.js";
import {toDateStr} from "../supervisorDashboard/dateRanges.js";

export function statusLabel(status) {
  return getStatusLabel(status) || status || "Unknown";
}

function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function durationLabel(hours) {
  if (hours === null || hours === undefined) return "Unknown";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function buildQuoteTimeline(quote, now = Date.now(), activities = []) {
  const issues = [];
  const issueDetails = [];
  function addIssue(message, at = null) {
    issues.push(message);
    issueDetails.push({message, at});
  }
  const events = [];
  const created = timestamp(quote.created_date);
  if (created === null || created > now) addIssue("Missing, invalid, or future creation date", created);
  else events.push({
    kind: "created", at: created, actor: quote.created_by_email || quote.created_by || null,
    reason: null, from: null, to: null, hours: null, source: "Quote creation date"
  });
  const raw = Array.isArray(quote.status_history) ? quote.status_history : [];
  if (!raw.length) addIssue("No recorded status history");
  const ordered = raw.map((entry, index) => ({entry, index, at: timestamp(entry?.changed_at)}))
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.index - b.index);
  let previous = null;
  let uncertain = false;
  const visited = new Set();
  let revisits = 0;
  for (const {entry, at} of ordered) {
    if (entry?.entry_type === "follow_up") {
      if (at === null || at > now) {
        addIssue("Follow-up has an invalid, missing, or future date", at);
      } else {
        if (created !== null && at < created) addIssue("Recorded follow-up predates quote creation date; recorded timestamp retained", at);
        events.push({
          at, actor: entry.changed_by || null, reason: entry.reason || null,
          from: null, to: entry.status || null, hours: null,
          source: "Status History", kind: "follow_up"
        });
      }
      continue;
    }
    if (!entry || at === null || at > now) {
      addIssue("Invalid, undated, or future history entry", at);
      uncertain = true;
      previous = null;
      continue;
    }
    if (created !== null && at < created) addIssue("Recorded status predates quote creation date; recorded timestamp retained", at);
    const event = {
      at, actor: entry.changed_by || null, reason: entry.reason || null,
      from: previous?.status || null, to: entry.status || null, hours: null, source: "Status History"
    };
    if (!entry.status) {
      addIssue("History entry missing status", at);
      uncertain = true;
      previous = null;
      continue;
    }
    if (previous?.status === entry.status) {
      events.push({...event, kind: "note"});
      continue;
    }
    if (visited.has(entry.status)) revisits++;
    visited.add(entry.status);
    events.push({
      ...event, kind: previous ? "transition" : "recorded",
      hours: previous ? (at - previous.at) / 3600000 : null
    });
    previous = {status: entry.status, at};
  }
  if (previous && previous.status !== quote.status) addIssue("Current status differs from latest recorded status", previous.at);
  if (uncertain) {
    for (const event of events) {
      if (event.kind === "transition") event.hours = null;
    }
  }
  const datedVisits = [];
  let currentVisitIndex = -1;
  for (const {entry, at} of ordered) {
    if (!entry?.status || entry.entry_type === "follow_up" || at === null || at > now) continue;
    if (entry.status === datedVisits[datedVisits.length - 1]?.status) continue;
    datedVisits.push({status: entry.status, at});
    if (entry.status === quote.status) currentVisitIndex = datedVisits.length - 1;
  }
  const currentSince = datedVisits[currentVisitIndex]?.at ?? null;
  const previousVisit = currentVisitIndex > 0 ? datedVisits[currentVisitIndex - 1] : null;
  const beforePreviousVisit = currentVisitIndex > 1 ? datedVisits[currentVisitIndex - 2] : null;
  const latestStatusEvent = [...events].reverse().find(event => event.kind === "transition" || event.kind === "recorded");
  const latestTransition = !uncertain && latestStatusEvent?.to === quote.status && latestStatusEvent?.kind === "transition"
    ? latestStatusEvent : null;
  const audit = activities.filter(activity => activity.quote_id === quote.id);
  const creations = [];
  for (const activity of audit) {
    const at = timestamp(activity.action_at);
    if (at === null || at > now) {
      addIssue("Activity log has an invalid, missing, or future action date", at);
      continue;
    }
    const changes = Array.isArray(activity.field_changes) ? activity.field_changes : [];
    const statusChange = changes.find(change => change.field === "status");
    const sameStatus = (a, b) => a === b || (a && b && statusLabel(a) === statusLabel(b));
    if (activity.action !== "created" && statusChange?.new_value
      && !sameStatus(statusChange.previous_value, statusChange.new_value)
      && !raw.some(entry => entry?.entry_type !== "follow_up" && sameStatus(entry?.status, statusChange.new_value))) {
      addIssue("Activity log status change has no matching Status History entry", at);
    }
    const event = {
      kind: activity.action === "created" ? "created" : "audit",
      at, actor: activity.performed_by || null, from: null, to: null, hours: null,
      source: "Activity Log", activityId: activity.id, action: activity.action,
      fields: Array.isArray(activity.changed_fields) ? activity.changed_fields : [],
      changes, reason: null
    };
    if (event.kind === "created") creations.push(event);
    else events.push(event);
  }
  if (creations.length) {
    creations.sort((a, b) => a.at - b.at);
    const existing = events.findIndex(event => event.kind === "created");
    if (existing >= 0) events.splice(existing, 1);
    events.push(creations[0]);
    if (creations.length > 1) addIssue("Multiple creation activity records; earliest recorded creation used", creations[0].at);
  }
  return {
    quote, events: events.sort((a, b) => a.at - b.at), issues: [...new Set(issues)], issueDetails,
    created: created !== null && created <= now ? created : null,
    currentSince, currentHours: currentSince === null ? null : (now - currentSince) / 3600000,
    previousStatus: previousVisit?.status || null,
    previousFromStatus: beforePreviousVisit?.status || null,
    previousHours: beforePreviousVisit ? (previousVisit.at - beforePreviousVisit.at) / 3600000 : null,
    latestTransition,
    revisits
  };
}

function inRange(at, range) {
  const day = toDateStr(new Date(at));
  return (!range.start || day >= range.start) && (!range.end || day <= range.end);
}

export function buildQuoteLifecycleReport(quotes, {range = {}, status = "all", search = "", includeOnHold = true, includeExcluded = true, now = Date.now(), activities = []} = {}) {
  const term = search.trim().toLowerCase();
  const byQuote = new Map();
  for (const activity of activities) {
    if (!byQuote.has(activity.quote_id)) byQuote.set(activity.quote_id, []);
    byQuote.get(activity.quote_id).push(activity);
  }
  const timelines = quotes
    .filter(quote => quote.is_current_version !== false
      && (includeOnHold || quote.status !== "on_hold")
      && (includeExcluded || !quote.exclude_from_reporting)
      && (status === "all" || quote.status === status)
      && (!term || [quote.quote_number, quote.id, quote.case_number, quote.site_id, quote.customer_name,
        quote.owner_email, quote.created_by].some(value => String(value || "").toLowerCase().includes(term))))
    .map(quote => buildQuoteTimeline(quote, now, byQuote.get(quote.id) || []));
  const activity = timelines.flatMap(timeline => timeline.events
    .filter(event => inRange(event.at, range))
    .map(event => ({...event, quote: timeline.quote})))
    .sort((a, b) => b.at - a.at);
  const transitions = activity.filter(event => event.kind === "transition");
  const groups = new Map();
  for (const {latestTransition: event} of timelines) {
    if (!event) continue;
    if (event.hours === null) continue;
    const key = JSON.stringify([event.from, event.to]);
    if (!groups.has(key)) groups.set(key, {from: event.from, to: event.to, hours: []});
    groups.get(key).hours.push(event.hours);
  }
  const durations = [...groups.values()].map(group => {
    const sorted = [...group.hours].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return {
      from: group.from, to: group.to, count: sorted.length,
      average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      longest: sorted[sorted.length - 1]
    };
  }).sort((a, b) => b.average - a.average);
  const statusCounts = new Map();
  for (const timeline of timelines) {
    const key = timeline.quote.status || "unknown";
    if (!statusCounts.has(key)) statusCounts.set(key, {status: key, count: 0, hours: [], unknown: 0});
    const bucket = statusCounts.get(key);
    bucket.count++;
    if (timeline.currentHours === null) bucket.unknown++;
    else bucket.hours.push(timeline.currentHours);
  }
  const daily = new Map();
  for (const event of activity) {
    if (!["created", "transition"].includes(event.kind)) continue;
    const date = toDateStr(new Date(event.at));
    if (!daily.has(date)) daily.set(date, {date, created: 0, transitions: 0});
    daily.get(date)[event.kind === "created" ? "created" : "transitions"]++;
  }
  return {
    timelines, activity, transitions, durations,
    newQuotes: activity.filter(event => event.kind === "created").length,
    workedQuotes: new Set(activity
      .filter(event => event.kind === "transition" || event.kind === "follow_up")
      .map(event => event.quote.id)).size,
    changedQuotes: new Set(transitions.map(event => event.quote.id)).size,
    issues: timelines.filter(timeline => timeline.issues.length),
    periodIssues: timelines.filter(timeline => timeline.issueDetails.some(issue => issue.at !== null && inRange(issue.at, range))),
    undatedIssues: timelines.filter(timeline => timeline.issueDetails.some(issue => issue.at === null)),
    revisitedQuotes: timelines.filter(timeline => timeline.revisits > 0).length,
    statuses: [...statusCounts.values()],
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}
