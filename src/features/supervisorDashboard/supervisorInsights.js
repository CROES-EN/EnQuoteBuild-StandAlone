/**
 * Pure calculations behind the Supervisor Dashboard insight sections: data freshness,
 * Quote Backlog flow, hygiene trend and heatmap, Auto-Drafter accuracy, Panel RMA cycle
 * time, and the extra Daily Snapshot summary bullets. No I/O; relative imports only so the
 * module runs under node:test.
 */
import {hygieneFlagCategories} from "../autoDrafter/quoteRequestHygiene.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = value => Math.round(value * 10) / 10;
const average = values => values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const percent = (part, whole) => whole ? Math.round(part / whole * 100) : 0;

export function localDateString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function priorBusinessDate(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do date.setDate(date.getDate() - 1); while (date.getDay() === 0 || date.getDay() === 6);
  return localDateString(date);
}

// ---------------------------------------------------------------- data freshness
/**
 * source: {kind: "live"} | {kind: "import", name, importedAt, importMethod} |
 *         {kind: "daily", name, latestDate} | {kind: "missing", name}
 * Imports are stale when imported before the prior business day; daily records are stale
 * when their latest date is before the prior business day.
 */
export function describeFreshness(source, now = new Date()) {
  if (!source) return null;
  if (source.kind === "live") return {text: "Live from EnQuote", stale: false, tone: "live"};
  if (source.kind === "missing") return {text: `${source.name || "Report"} not imported`, stale: true, tone: "missing"};
  const cutoff = priorBusinessDate(now);
  if (source.kind === "daily") {
    if (!source.latestDate) return {text: `No ${source.name || "daily"} data yet`, stale: true, tone: "missing"};
    const stale = source.latestDate < cutoff;
    return {text: `${source.name || "Daily data"} through ${formatShortDate(source.latestDate)}`, stale, tone: stale ? "stale" : "fresh"};
  }
  const date = new Date(source.importedAt);
  if (!source.importedAt || Number.isNaN(date.getTime())) return {text: `${source.name || "Report"} import time unknown`, stale: true, tone: "stale"};
  const when = date.toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  const stale = localDateString(date) < cutoff;
  return {
    text: `${source.importMethod === "auto" ? "Auto-imported" : "Imported"} ${when}${source.name ? ` · ${source.name}` : ""}`,
    stale, tone: stale ? "stale" : "fresh"
  };
}

function formatShortDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? dateString : date.toLocaleDateString(undefined, {month: "short", day: "numeric", timeZone: "UTC"});
}

/** Oldest import among the given report tables (the tile is only as fresh as its oldest input). */
export function importFreshnessSource(tables, reportTypes, name) {
  const present = reportTypes.map(type => tables?.[type]).filter(Boolean);
  if (!present.length) return {kind: "missing", name};
  const oldest = present.reduce((min, table) =>
    !min || String(table.importedAt || "") < String(min.importedAt || "") ? table : min, null);
  return {kind: "import", name, importedAt: oldest.importedAt, importMethod: oldest.importMethod};
}

// ---------------------------------------------------------------- backlog flow
/**
 * entries: [{date, snapshot}] (any order; snapshot may be null for days never captured).
 * Each captured day is compared with the previous captured day: "added" quotes entered the
 * backlog, "left" quotes are no longer in it (completed, moved past the backlog statuses,
 * or deleted).
 */
export function buildBacklogFlow(entries) {
  const captured = (entries || []).filter(entry => entry?.snapshot && Array.isArray(entry.snapshot.rows))
    .sort((a, b) => a.date.localeCompare(b.date));
  let previous = null;
  return captured.map(({date, snapshot}) => {
    const quotes = new Map(snapshot.rows.map(row => [row.quote.id, row.quote]));
    const overdue = snapshot.rows.filter(row => row.alert?.overdueHours > 0).length;
    let row = {date, opening: null, added: null, left: null, closing: snapshot.count ?? quotes.size, overdue,
      comparedTo: null, addedQuotes: [], leftQuotes: []};
    if (previous) {
      const addedQuotes = [...quotes.values()].filter(quote => !previous.quotes.has(quote.id));
      const leftQuotes = [...previous.quotes.values()].filter(quote => !quotes.has(quote.id));
      row = {...row, opening: previous.count, added: addedQuotes.length, left: leftQuotes.length, comparedTo: previous.date,
        addedQuotes: addedQuotes.map(quoteLabel), leftQuotes: leftQuotes.map(quoteLabel)};
    }
    previous = {date, quotes, count: row.closing};
    return row;
  });
}

const quoteLabel = quote => quote.quote_number || quote.case_number || quote.id;

// ---------------------------------------------------------------- hygiene trend + heatmap
export function hygieneSnapshotFromReport(report, date) {
  if (!report || !date) return null;
  return {
    id: `hygiene:${date}`, date, importedAt: report.importedAt || null, sourceFileName: report.sourceFileName || "",
    requests: report.records.length, flagged: report.flagged.length,
    issues: Object.fromEntries(report.issues.map(issue => [issue.issue, issue.cases])),
    authors: report.authors.map(author => ({author: author.author, requests: author.requests, flagged: author.flagged, issues: {...(author.issues || {})}}))
  };
}

export function buildHygieneTrend(snapshots) {
  const rows = (snapshots || []).filter(snapshot => snapshot?.date && !snapshot.is_deleted)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(snapshot => ({date: snapshot.date, requests: snapshot.requests || 0, flagged: snapshot.flagged || 0,
      rate: percent(snapshot.flagged || 0, snapshot.requests || 0), issues: snapshot.issues || {}}));
  const totals = new Map();
  for (const row of rows) for (const [issue, cases] of Object.entries(row.issues)) totals.set(issue, (totals.get(issue) || 0) + cases);
  const issues = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([issue]) => issue);
  return {rows, issues};
}

/** Author x flag-category matrix for authors with at least one flagged case. */
export function buildHygieneHeatmap(report, {maxAuthors = 15} = {}) {
  if (!report) return {issues: [], rows: [], max: 0};
  const issues = report.issues.map(issue => issue.issue);
  const rows = report.authors.filter(author => author.flagged > 0).slice(0, maxAuthors).map(author => {
    const counts = author.issues || countAuthorIssues(report, author.author);
    return {author: author.author, requests: author.requests, flagged: author.flagged,
      cells: issues.map(issue => ({issue, count: counts[issue] || 0, rate: percent(counts[issue] || 0, author.requests)}))};
  });
  return {issues, rows, max: Math.max(0, ...rows.flatMap(row => row.cells.map(cell => cell.count)))};
}

function countAuthorIssues(report, author) {
  const counts = {};
  for (const record of report.records) {
    if (record.author.toLowerCase() !== author.toLowerCase()) continue;
    for (const issue of hygieneFlagCategories(record.flags)) counts[issue] = (counts[issue] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------- Auto-Drafter accuracy
const normalizePhrase = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

export function buildAutoDrafterAccuracy(records, swaps = []) {
  const drafts = (records || []).filter(record => record && !record.is_deleted);
  const sent = drafts.filter(record => record.sentToQuotes);
  const sentUnedited = sent.filter(record => !record.editedBeforeSend).length;
  const confidence = {high: 0, medium: 0, low: 0};
  const phrases = new Map();
  for (const record of drafts) {
    for (const item of record.draft?.items || []) {
      const level = ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "medium";
      confidence[level] += 1;
      if (level === "high") continue;
      const phrase = item.source_line?.name || item.requested_name || item.name;
      const key = normalizePhrase(phrase);
      if (!key) continue;
      const entry = phrases.get(key) || {phrase: String(phrase).trim(), notInCatalog: 0, needsReview: 0, cases: new Set()};
      entry[level === "low" ? "notInCatalog" : "needsReview"] += 1;
      if (record.caseNumber) entry.cases.add(String(record.caseNumber));
      phrases.set(key, entry);
    }
  }
  const items = confidence.high + confidence.medium + confidence.low;
  const activeSwaps = (swaps || []).filter(swap => !swap.is_deleted && swap.kind !== "category_case" && swap.kind !== "category_rule");
  return {
    drafts: drafts.length, sent: sent.length, sentUnedited, sentEdited: sent.length - sentUnedited,
    uneditedRate: sent.length ? percent(sentUnedited, sent.length) : null,
    items, confidence, highRate: items ? percent(confidence.high, items) : null,
    topPhrases: [...phrases.values()].map(entry => ({phrase: entry.phrase, notInCatalog: entry.notInCatalog,
      needsReview: entry.needsReview, total: entry.notInCatalog + entry.needsReview, cases: entry.cases.size}))
      .sort((a, b) => b.total - a.total || b.cases - a.cases || a.phrase.localeCompare(b.phrase)).slice(0, 8),
    learnedSwaps: activeSwaps.length,
    recentSwaps: [...activeSwaps].sort((a, b) => String(b.taughtAt || "").localeCompare(String(a.taughtAt || ""))).slice(0, 5)
  };
}

// ---------------------------------------------------------------- Panel RMA cycle time
const DECISION_STATUSES = new Set(["Approved", "Rejected", "Deadend"]);
const daysBetween = (start, end) => Math.max(0, (end - start) / DAY_MS);
const toTime = value => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

export function buildPanelRmaCycleMetrics(rmas, now = new Date()) {
  const nowTime = now.getTime();
  const byManufacturer = new Map();
  const dwell = new Map();
  const open = [];
  for (const rma of (rmas || []).filter(record => record && !record.is_deleted)) {
    const created = toTime(rma.created_date);
    if (created === null) continue;
    const history = [...(rma.status_history || [])].filter(entry => toTime(entry.changed_at) !== null)
      .sort((a, b) => toTime(a.changed_at) - toTime(b.changed_at));
    const statusOf = entry => entry.new_status || entry.status;
    const isClosed = rma.current_status === "Closed";
    const closedEntry = [...history].reverse().find(entry => statusOf(entry) === "Closed");
    const closedAt = isClosed ? (toTime(closedEntry?.changed_at) ?? toTime(rma.updated_date) ?? nowTime) : null;
    const submitted = history.find(entry => statusOf(entry) === "RMA Submitted");
    const submittedAt = toTime(submitted?.changed_at);
    const decision = submittedAt === null ? null : history.find(entry => DECISION_STATUSES.has(statusOf(entry)) && toTime(entry.changed_at) >= submittedAt);
    const manufacturer = String(rma.panel_manufacturer || "").trim() || "Unknown manufacturer";
    const summary = byManufacturer.get(manufacturer.toLowerCase()) ||
      {manufacturer, open: 0, closed: 0, closeDays: [], openAges: [], submitDays: [], decisionDays: []};
    if (isClosed) {
      summary.closed += 1;
      summary.closeDays.push(daysBetween(created, closedAt));
    } else {
      summary.open += 1;
      summary.openAges.push(daysBetween(created, nowTime));
      const lastChange = toTime(history.at(-1)?.changed_at) ?? created;
      open.push({id: rma.id, caseId: rma.case_id || "", siteId: rma.site_id || "", manufacturer,
        status: rma.current_status || "Unknown", daysOpen: Math.floor(daysBetween(created, nowTime)),
        daysInStatus: Math.floor(daysBetween(lastChange, nowTime))});
    }
    if (submittedAt !== null) summary.submitDays.push(daysBetween(created, submittedAt));
    if (decision) summary.decisionDays.push(daysBetween(submittedAt, toTime(decision.changed_at)));
    byManufacturer.set(manufacturer.toLowerCase(), summary);
    // Time spent in each status: from each change until the next change (or now / close).
    const segments = history.length ? history : [{new_status: rma.current_status, changed_at: rma.created_date}];
    segments.forEach((entry, index) => {
      const status = statusOf(entry);
      if (!status || status === "Closed") return;
      const start = toTime(entry.changed_at);
      const end = index + 1 < segments.length ? toTime(segments[index + 1].changed_at) : (closedAt ?? nowTime);
      const current = dwell.get(status) || {status, days: [], current: 0};
      current.days.push(daysBetween(start, end));
      if (index === segments.length - 1 && !isClosed) current.current += 1;
      dwell.set(status, current);
    });
  }
  const manufacturers = [...byManufacturer.values()].map(summary => ({
    manufacturer: summary.manufacturer, open: summary.open, closed: summary.closed, total: summary.open + summary.closed,
    avgDaysToClose: average(summary.closeDays), avgOpenAge: average(summary.openAges),
    avgDaysToSubmit: average(summary.submitDays), avgDecisionDays: average(summary.decisionDays)
  })).sort((a, b) => b.open - a.open || b.total - a.total || a.manufacturer.localeCompare(b.manufacturer));
  return {
    open: open.length, closed: manufacturers.reduce((sum, item) => sum + item.closed, 0),
    avgDaysToClose: average([...byManufacturer.values()].flatMap(summary => summary.closeDays)),
    manufacturers,
    oldestOpen: open.sort((a, b) => b.daysOpen - a.daysOpen || b.daysInStatus - a.daysInStatus).slice(0, 8),
    statusDwell: [...dwell.values()].map(entry => ({status: entry.status, avgDays: average(entry.days), visits: entry.days.length, currentlyIn: entry.current}))
      .sort((a, b) => (b.avgDays ?? 0) - (a.avgDays ?? 0))
  };
}

// ---------------------------------------------------------------- Daily Snapshot bullets
export function draftInsightBullets({backlogFlow, hygiene, drafter, rma} = {}) {
  const bullets = [];
  if (backlogFlow) {
    bullets.push(backlogFlow.opening === null
      ? `Quote backlog ${backlogFlow.closing}; ${backlogFlow.overdue} overdue (no prior snapshot to compare).`
      : `Quote backlog ${backlogFlow.closing} (opened at ${backlogFlow.opening}: +${backlogFlow.added} new, -${backlogFlow.left} left the backlog); ${backlogFlow.overdue} overdue.`);
  }
  if (hygiene?.requests) {
    const issues = Array.isArray(hygiene.issues) ? hygiene.issues
      : Object.entries(hygiene.issues || {}).map(([issue, cases]) => ({issue, cases})).sort((a, b) => b.cases - a.cases || a.issue.localeCompare(b.issue));
    const top = issues[0];
    bullets.push(`${hygiene.flagged} of ${hygiene.requests} quote requests (${percent(hygiene.flagged, hygiene.requests)}%) need intake correction` +
      (top ? `; most common flag: ${top.issue} (${top.cases}).` : "."));
  }
  if (drafter?.sent) {
    bullets.push(`${drafter.sentUnedited} of ${drafter.sent} Auto-Drafter quotes (${drafter.uneditedRate}%) were sent without edits; ` +
      `${drafter.confidence.low} draft line item${drafter.confidence.low === 1 ? " was" : "s were"} not in the catalog.`);
  }
  if (rma?.open) {
    const oldest = rma.oldestOpen[0];
    bullets.push(`${rma.open} open Panel RMA${rma.open === 1 ? "" : "s"}` +
      (oldest ? `; oldest is ${oldest.daysOpen} days (${oldest.manufacturer}, ${oldest.status}).` : "."));
  }
  return bullets;
}
