import test from "node:test";
import assert from "node:assert/strict";
import {buildQuoteTimeline, buildQuoteLifecycleReport, durationLabel} from "../src/features/quoteDashboard/quoteLifecycle.js";

const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const now = new Date(2026, 9, 10, 12).getTime();
const entry = (status, day, extra = {}) => ({status, changed_at: at(day), changed_by: "owner@example.test", ...extra});
const quote = (extra = {}) => ({
  id: "q1", quote_number: "Q-001", created_date: at(1),
  status: "approved",
  status_history: [entry("draft", 1), entry("submitted", 2), entry("approved", 4)],
  ...extra
});

test("Creation, transitions, actor, reason, exact stage durations and live age", () => {
  const result = buildQuoteTimeline(quote(), now);
  assert.deepEqual(result.events.map(event => event.kind), ["created", "recorded", "transition", "transition"]);
  assert.deepEqual(result.events.filter(event => event.kind === "transition").map(event => event.hours), [24, 48]);
  assert.equal(result.events[2].actor, "owner@example.test");
  assert.equal(result.currentHours, 144);
  assert.equal(result.currentSince, Date.parse(at(4)));
  assert.deepEqual(result.issues, []);
});

test("Follow-up and repeated status notes never reset the stage clock", () => {
  const result = buildQuoteTimeline(quote({status_history: [
    entry("draft", 1), entry("submitted", 2),
    entry("submitted", 3, {entry_type: "follow_up", reason: "Called customer"}),
    entry("submitted", 3, {reason: "Edited notes"}), entry("approved", 4)
  ]}), now);
  assert.equal(result.events.filter(event => event.kind === "transition").length, 2);
  assert.equal(result.events.find(event => event.to === "approved").hours, 48);
  assert.equal(result.events.find(event => event.kind === "follow_up").reason, "Called customer");
  const ongoing = buildQuoteTimeline(quote({
    status: "submitted", status_history: [entry("submitted", 2), entry("submitted", 8, {entry_type: "follow_up"})]
  }), now);
  assert.equal(ongoing.currentHours, 192);
});

test("Invoice Paid Aug 28 08:35 to Scheduled Sep 10 11:38 ignores both follow-ups", () => {
  const paidAt = "2026-08-28T08:35:00-06:00";
  const scheduledAt = "2026-09-10T11:38:00-06:00";
  const asOf = Date.parse("2026-09-11T11:38:00-06:00");
  const history = [
    {status: "invoice_paid", changed_at: paidAt},
    {status: "invoice_paid", entry_type: "follow_up", changed_at: "2026-09-03T13:22:00-06:00"},
    {status: "invoice_paid", entry_type: "follow_up", changed_at: "2026-09-08T11:28:00-06:00"},
    {status: "scheduled", changed_at: scheduledAt}
  ];
  const item = quote({created_date: paidAt, status: "scheduled", status_history: history});
  const report = buildQuoteLifecycleReport([item], {
    now: asOf, range: {start: "2026-09-10", end: "2026-09-10"}
  });
  assert.equal(report.transitions.length, 1);
  assert.equal(report.transitions[0].from, "invoice_paid");
  assert.equal(report.transitions[0].to, "scheduled");
  assert.equal(report.transitions[0].hours, 315.05);
  assert.equal(Math.round(report.transitions[0].hours * 60), 13 * 24 * 60 + 3 * 60 + 3);
  assert.equal(report.durations[0].average, 315.05);
  assert.equal(report.timelines[0].currentSince, Date.parse(scheduledAt));
  assert.equal(report.timelines[0].currentHours, 24);
  const withoutFollowUps = buildQuoteTimeline({...item, status_history: history.filter(entry => entry.entry_type !== "follow_up")}, asOf);
  assert.deepEqual(
    report.timelines[0].events.filter(event => event.kind === "transition"),
    withoutFollowUps.events.filter(event => event.kind === "transition")
  );
});

test("Malformed or future follow-ups are flagged but cannot invalidate status timing", () => {
  for (const changed_at of [undefined, "invalid", at(11)]) {
    const result = buildQuoteTimeline(quote({status_history: [
      entry("draft", 1), entry("submitted", 2),
      {entry_type: "follow_up", changed_at, status: "scheduled"},
      entry("approved", 4)
    ]}), now);
    assert.deepEqual(result.events.filter(event => event.kind === "transition").map(event => event.hours), [24, 48]);
    assert.equal(result.currentHours, 144);
    assert.ok(result.issues.includes("Follow-up has an invalid, missing, or future date"));
  }
});

test("Unsorted records are ordered, repeat visits are distinct, and zero durations are valid", () => {
  const result = buildQuoteTimeline(quote({
    status: "submitted", status_history: [
      entry("submitted", 5), entry("rejected", 4), entry("submitted", 2),
      entry("draft", 1), entry("approved", 5)
    ]
  }), now);
  assert.equal(result.revisits, 1);
  assert.deepEqual(result.events.filter(event => event.kind === "transition").map(event => event.hours), [24, 48, 24, 0]);
  assert.equal(result.currentHours, 120);
  assert.equal(result.latestTransition, null);
  assert.ok(result.issues.includes("Current status differs from latest recorded status"));
});

test("Range selects event dates, not creation dates; full dwell survives entry before range", () => {
  const report = buildQuoteLifecycleReport([quote()], {now, range: {start: "2026-10-04", end: "2026-10-04"}});
  assert.equal(report.newQuotes, 0);
  assert.equal(report.transitions.length, 1);
  assert.equal(report.changedQuotes, 1);
  assert.equal(report.durations[0].average, 48);
  assert.equal(report.timelines.length, 1);
  assert.equal(report.statuses[0].count, 1);
  assert.equal(report.timelines[0].events.length, 4);
});

test("All quotes contribute only their latest status pair to timings, independent of activity range", () => {
  const report = buildQuoteLifecycleReport([
    quote(),
    quote({id: "q2", status: "scheduled", status_history: [
      entry("draft", 1), entry("submitted", 2), entry("approved", 3),
      entry("invoice_paid", 4), entry("invoice_paid", 6, {entry_type: "follow_up"}),
      entry("scheduled", 8), entry("scheduled", 9, {entry_type: "follow_up"})
    ]})
  ], {now, range: {start: "2026-10-10", end: "2026-10-10"}});
  assert.equal(report.transitions.length, 0);
  assert.equal(report.durations.length, 2);
  assert.ok(!report.durations.some(row => row.from === "draft" || row.to === "invoice_paid"));
  assert.equal(report.durations.reduce((sum, row) => sum + row.count, 0), 2);
  const first = report.timelines[0];
  assert.equal(first.previousStatus, "submitted");
  assert.equal(first.previousFromStatus, "draft");
  assert.equal(first.previousHours, 24);
  assert.equal(first.currentHours, 144);
  const second = report.timelines[1];
  assert.equal(second.previousStatus, "invoice_paid");
  assert.equal(second.previousFromStatus, "approved");
  assert.equal(second.previousHours, 24);
  assert.equal(second.currentHours, 48);
});

test("A single recorded status has known current age but unknown previous status", () => {
  const result = buildQuoteTimeline(quote({status_history: [entry("approved", 4)]}), now);
  assert.equal(result.currentHours, 144);
  assert.equal(result.previousStatus, null);
  assert.equal(result.previousHours, null);
  assert.equal(result.latestTransition, null);
});

test("All quotes measure the interval into the previous status, not its interval into the current status", () => {
  const report = buildQuoteLifecycleReport([
    quote({quote_number: "Q-7392747426", status: "invoice_paid", status_history: [
      entry("ho_approved_invoice_required", 1), entry("invoiced", 3), entry("invoice_paid", 8)
    ]}),
    quote({id: "q2", status: "scheduled", status_history: [
      entry("approved", 2), entry("invoice_paid", 5), entry("scheduled", 9)
    ]})
  ], {now, range: {start: "2026-10-10", end: "2026-10-10"}});
  assert.deepEqual(report.timelines.map(item => [item.previousFromStatus, item.previousStatus, item.previousHours]), [
    ["ho_approved_invoice_required", "invoiced", 48],
    ["approved", "invoice_paid", 72]
  ]);
  assert.deepEqual(report.timelines.map(item => item.currentHours), [48, 24]);
});

test("Previous-status recovery ignores older gaps, follow-ups, notes, and later mismatched entries", () => {
  const result = buildQuoteTimeline(quote({status: "invoice_paid", created_date: at(7), status_history: [
    {status: "draft", changed_at: "invalid"},
    entry("ho_approved_invoice_required", 1),
    entry("ho_approved_invoice_required", 2, {entry_type: "follow_up"}),
    entry("invoiced", 3), entry("invoiced", 4),
    entry("invoiced", 6, {entry_type: "follow_up"}),
    entry("invoice_paid", 8), entry("scheduled", 9),
    {entry_type: "follow_up", status: "invoiced", changed_at: "invalid"}
  ]}), now);
  assert.equal(result.previousFromStatus, "ho_approved_invoice_required");
  assert.equal(result.previousStatus, "invoiced");
  assert.equal(result.previousHours, 48);
  assert.equal(result.currentHours, 48);
  assert.equal(result.latestTransition, null);
  assert.ok(result.issues.length > 0);
});

test("Previous interval uses the visits immediately before the latest matching current-status visit", () => {
  const result = buildQuoteTimeline(quote({status: "invoice_paid", status_history: [
    entry("ho_approved_invoice_required", 1), entry("invoiced", 2), entry("invoice_paid", 3),
    entry("ho_approved_invoice_required", 4), entry("invoiced", 6), entry("invoice_paid", 9)
  ]}), now);
  assert.equal(result.previousStatus, "invoiced");
  assert.equal(result.previousHours, 48);
  assert.equal(result.currentHours, 24);
});

test("Previous status can be known without its earlier interval; missing current anchor stays unknown", () => {
  const result = buildQuoteTimeline(quote({status_history: [entry("submitted", 2), entry("approved", 4)]}), now);
  assert.equal(result.previousStatus, "submitted");
  assert.equal(result.previousFromStatus, null);
  assert.equal(result.previousHours, null);
  for (const history of [
    [entry("draft", 1), entry("submitted", 2)],
    [entry("draft", 1), entry("submitted", 2), entry("approved", 11)],
    [entry("draft", 1), entry("submitted", 2), entry("approved", 4, {entry_type: "follow_up"})]
  ]) {
    assert.equal(buildQuoteTimeline(quote({status_history: history}), now).previousStatus, null);
  }
});

test("A zero-hour interval into the previous status is valid", () => {
  const result = buildQuoteTimeline(quote({status_history: [
    entry("draft", 2), entry("submitted", 2), entry("approved", 4)
  ]}), now);
  assert.equal(result.previousStatus, "submitted");
  assert.equal(result.previousHours, 0);
});

test("Inclusive local calendar boundaries and daily totals", () => {
  const early = quote({created_date: at(2, 0), status: "draft", status_history: [entry("draft", 2)]});
  const late = quote({id: "q2", created_date: at(2, 23), status: "draft", status_history: [{status: "draft", changed_at: at(2, 23)}]});
  const next = quote({id: "q3", created_date: at(3, 0), status_history: []});
  const report = buildQuoteLifecycleReport([early, late, next], {now, range: {start: "2026-10-02", end: "2026-10-02"}});
  assert.equal(report.newQuotes, 2);
  assert.deepEqual(report.daily, [{date: "2026-10-02", created: 2, transitions: 0}]);
});

test("All current quotes included by default; hold/exclusion/status/search filters are explicit", () => {
  const items = [
    quote(),
    quote({id: "hold", status: "on_hold", site_id: "12345"}),
    quote({id: "excluded", exclude_from_reporting: true, owner_email: "person@example.test"}),
    quote({id: "old", is_current_version: false})
  ];
  assert.equal(buildQuoteLifecycleReport(items, {now}).timelines.length, 3);
  assert.equal(buildQuoteLifecycleReport(items, {now, includeOnHold: false, includeExcluded: false}).timelines.length, 1);
  assert.equal(buildQuoteLifecycleReport(items, {now, status: "on_hold"}).timelines[0].quote.id, "hold");
  assert.equal(buildQuoteLifecycleReport(items, {now, search: "PERSON@"}).timelines[0].quote.id, "excluded");
  assert.equal(buildQuoteLifecycleReport(items, {now, search: "12345"}).timelines[0].quote.id, "hold");
});

test("Missing history does not invent transitions or stage age from updated_date", () => {
  const report = buildQuoteLifecycleReport([quote({status_history: [], updated_date: at(9)})], {now});
  assert.equal(report.transitions.length, 0);
  assert.equal(report.timelines[0].currentHours, null);
  assert.equal(report.issues.length, 1);
  assert.equal(report.statuses[0].unknown, 1);
  assert.equal(report.newQuotes, 1);
});

test("Current age survives older history gaps, mismatched creation date and later unrelated status entries", () => {
  for (const item of [
    quote({status_history: [{status: "draft", changed_at: "invalid"}, entry("approved", 4)]}),
    quote({created_date: at(8), status_history: [entry("approved", 4)]}),
    quote({status_history: [entry("approved", 4), entry("scheduled", 7)]}),
    quote({status_history: [entry("approved", 4), {status: "submitted"}, entry("approved", 9, {entry_type: "follow_up"})]})
  ]) {
    const report = buildQuoteLifecycleReport([item], {now});
    assert.equal(report.timelines[0].currentSince, Date.parse(at(4)));
    assert.equal(report.timelines[0].currentHours, 144);
    assert.equal(report.statuses[0].unknown, 0);
    assert.deepEqual(report.statuses[0].hours, [144]);
    assert.equal(report.issues.length, 1, "History warnings remain visible");
  }
});

test("Current status re-entry uses its latest visit, not follow-ups or same-status notes", () => {
  const result = buildQuoteTimeline(quote({
    status: "submitted",
    status_history: [
      entry("submitted", 2), entry("rejected", 4), entry("submitted", 6),
      entry("submitted", 8), entry("submitted", 9, {entry_type: "follow_up"})
    ]
  }), now);
  assert.equal(result.currentSince, Date.parse(at(6)));
  assert.equal(result.currentHours, 96);
});

test("Current age remains unknown without a valid non-follow-up entry matching current status", () => {
  for (const history of [
    [], [entry("draft", 2)], [entry("approved", 4, {entry_type: "follow_up"})],
    [{status: "approved", changed_at: "invalid"}], [entry("approved", 11)]
  ]) {
    assert.equal(buildQuoteTimeline(quote({status_history: history}), now).currentHours, null);
  }
});

test("Invalid and future history is flagged and timing excluded", () => {
  for (const bad of [
    {status: "submitted", changed_at: "invalid"},
    entry("submitted", 11),
    {status: "submitted"}, {changed_at: at(3)}
  ]) {
    const report = buildQuoteLifecycleReport([quote({status_history: [
      entry("draft", 1), bad, entry("approved", 4)
    ]})], {now});
    assert.equal(report.issues.length, 1);
    assert.equal(report.timelines[0].currentHours, 144);
    assert.equal(report.durations.length, 0);
  }
});

test("Unknown creation stays unknown; first recorded status is not assumed draft movement", () => {
  const report = buildQuoteLifecycleReport([quote({created_date: null, status_history: [entry("approved", 4)]})], {now});
  assert.equal(report.newQuotes, 0);
  assert.equal(report.transitions.length, 0);
  assert.equal(report.timelines[0].currentHours, 144);
  assert.equal(report.issues.length, 1);
});

test("Average, median, longest and samples calculated across independent stage visits", () => {
  const quotes = [2, 3, 6, 10].map((day, index) => quote({
    id: `q${index}`, status: "submitted", status_history: [entry("draft", 1), entry("submitted", day)]
  }));
  const report = buildQuoteLifecycleReport(quotes, {now});
  assert.equal(report.durations[0].count, 4);
  assert.equal(report.durations[0].average, 102);
  assert.equal(report.durations[0].median, 84);
  assert.equal(report.durations[0].longest, 216);
  assert.equal(report.changedQuotes, 4);
});

test("No quotes is genuinely empty and unknown/zero durations are not conflated", () => {
  const report = buildQuoteLifecycleReport([], {now});
  assert.equal(report.newQuotes, 0);
  assert.equal(report.transitions.length, 0);
  assert.equal(report.workedQuotes, 0);
  assert.equal(report.durations.length, 0);
  assert.equal(durationLabel(null), "Unknown");
  assert.equal(durationLabel(0), "0 min");
  assert.equal(durationLabel(48), "2.0 days");
});

test("Worked quotes are unique across status changes and follow-ups throughout the selected period", () => {
  const items = [
    quote({id: "both", status_history: [
      entry("draft", 1), entry("submitted", 2), entry("submitted", 3, {entry_type: "follow_up"}),
      entry("approved", 4), entry("approved", 5, {entry_type: "follow_up"})
    ]}),
    quote({id: "follow-up-only", status: "on_hold", exclude_from_reporting: true, status_history: [
      entry("on_hold", 1), entry("on_hold", 2, {entry_type: "follow_up"}),
      entry("on_hold", 4, {entry_type: "follow_up"})
    ]}),
    quote({id: "status-only", status_history: [entry("draft", 1), entry("approved", 4)]}),
    quote({id: "note-only", status_history: [entry("approved", 1), entry("approved", 3)]}),
    quote({id: "baseline-only", status_history: [entry("approved", 3)]}),
    quote({id: "outside", status_history: [entry("draft", 1), entry("approved", 6)]}),
    quote({id: "old-version", is_current_version: false}),
    quote({id: "edit-only", status_history: [entry("approved", 1)]})
  ];
  const report = buildQuoteLifecycleReport(items, {
    now, range: {start: "2026-10-02", end: "2026-10-05"},
    activities: [{quote_id: "edit-only", action: "updated", action_at: at(3), changed_fields: ["notes"]}]
  });
  assert.equal(report.workedQuotes, 3);
  assert.equal(report.changedQuotes, 2);
  assert.equal(report.newQuotes, 0);
  assert.equal(buildQuoteLifecycleReport(items, {now, range: {start: "2026-10-03", end: "2026-10-03"}}).workedQuotes, 1);
});

test("Created and worked counts honor inclusive local-date boundaries and creation activity precedence", () => {
  const items = [
    quote({id: "start", created_date: at(2, 0), status_history: [
      {status: "approved", changed_at: at(2, 0)},
      {status: "approved", entry_type: "follow_up", changed_at: at(2, 0)}
    ]}),
    quote({id: "end", created_date: at(2, 23), status_history: [
      {status: "draft", changed_at: at(2, 23)}, {status: "approved", changed_at: at(2, 23)}
    ]}),
    quote({id: "next", created_date: at(3, 0), status_history: []}),
    quote({id: "activity-date", created_date: at(1), status_history: []}),
    quote({id: "duplicate-create", created_date: at(2), status_history: []})
  ];
  const report = buildQuoteLifecycleReport(items, {
    now, range: {start: "2026-10-02", end: "2026-10-02"},
    activities: [
      {quote_id: "activity-date", action: "created", action_at: at(2)},
      {quote_id: "duplicate-create", action: "created", action_at: at(1)},
      {quote_id: "duplicate-create", action: "created", action_at: at(2)}
    ]
  });
  assert.equal(report.newQuotes, 3);
  assert.equal(report.workedQuotes, 2);
});

test("Activity creation is counted once and edits remain audit events, never stage transitions", () => {
  const activities = [
    {id: "create", quote_id: "q1", action: "created", action_at: at(1), performed_by: "creator@example.test"},
    {id: "edit", quote_id: "q1", action: "updated", action_at: at(4), performed_by: "reviewer@example.test",
      changed_fields: ["status"], field_changes: [{field: "status", previous_value: "submitted", new_value: "approved"}]}
  ];
  const report = buildQuoteLifecycleReport([quote()], {now, activities});
  assert.equal(report.newQuotes, 1);
  assert.equal(report.transitions.length, 2);
  assert.equal(report.activity.filter(event => event.kind === "audit").length, 1);
  const creation = report.activity.find(event => event.kind === "created");
  assert.equal(creation.source, "Activity Log");
  assert.equal(creation.actor, "creator@example.test");
  assert.equal(report.durations.find(row => row.to === "approved").average, 48);
  assert.equal(report.durations.length, 1);
  assert.equal(report.timelines[0].currentHours, 144);
  assert.equal(report.issues.length, 0);
});

test("Activity log fills creation date when quote date is missing; duplicate creation is flagged", () => {
  const activities = [
    {id: "c1", quote_id: "q1", action: "created", action_at: at(1)},
    {id: "c2", quote_id: "q1", action: "created", action_at: at(2)},
    {id: "unrelated", quote_id: "q2", action: "created", action_at: at(1)}
  ];
  const report = buildQuoteLifecycleReport([quote({created_date: null})], {now, activities});
  assert.equal(report.newQuotes, 1);
  assert.equal(report.activity.find(event => event.kind === "created").at, Date.parse(at(1)));
  assert.ok(report.issues[0].issues.includes("Multiple creation activity records; earliest recorded creation used"));
});

test("Activity status changes without matching history are flagged, never fabricated", () => {
  const activities = [
    {id: "edit", quote_id: "q1", action: "updated", action_at: at(7),
      changed_fields: ["status"], field_changes: [{field: "status", previous_value: "approved", new_value: "scheduled"}]},
    {id: "bad", quote_id: "q1", action: "updated", action_at: "invalid"}
  ];
  const report = buildQuoteLifecycleReport([quote()], {now, activities});
  assert.equal(report.transitions.length, 2);
  assert.equal(report.timelines[0].currentHours, 144);
  assert.ok(report.issues[0].issues.includes("Activity log status change has no matching Status History entry"));
  assert.ok(report.issues[0].issues.includes("Activity log has an invalid, missing, or future action date"));
  assert.ok(!report.transitions.some(event => event.to === "scheduled"));
});

test("Valid pre-creation statuses and follow-ups remain countable with discrepancy warnings", () => {
  const item = quote({created_date: at(8), status_history: [
    entry("draft", 1), entry("submitted", 2),
    entry("submitted", 3, {entry_type: "follow_up"}), entry("approved", 4)
  ]});
  const original = structuredClone(item);
  const report = buildQuoteLifecycleReport([item], {now, range: {start: "2026-10-02", end: "2026-10-03"}});
  assert.equal(report.workedQuotes, 1);
  assert.equal(report.transitions.length, 1);
  assert.equal(report.activity.filter(event => event.kind === "follow_up").length, 1);
  assert.equal(report.timelines[0].latestTransition.hours, 48);
  assert.ok(report.timelines[0].issues.includes("Recorded status predates quote creation date; recorded timestamp retained"));
  assert.ok(report.timelines[0].issues.includes("Recorded follow-up predates quote creation date; recorded timestamp retained"));
  assert.deepEqual(item, original, "Reporting never rewrites source records");
});

test("Audit no-op statuses and recognized display labels do not create false missing-history warnings", () => {
  const report = buildQuoteLifecycleReport([quote()], {now, activities: [
    {quote_id: "q1", action: "updated", action_at: at(5), field_changes: [
      {field: "status", previous_value: "scheduled", new_value: "scheduled"}
    ]},
    {quote_id: "q1", action: "updated", action_at: at(5), field_changes: [
      {field: "status", previous_value: "submitted", new_value: "Quote Approved"}
    ]}
  ]});
  assert.equal(report.issues.length, 0);
  assert.equal(report.workedQuotes, 1, "Audit logs do not invent extra work events");
});

test("Tile warnings separate dated period issues from undated issues and older or later warnings", () => {
  const report = buildQuoteLifecycleReport([
    quote({id: "old", status_history: [entry("draft", 1)]}),
    quote({id: "period", status_history: [entry("draft", 3)]}),
    quote({id: "future", status_history: [entry("approved", 11)]}),
    quote({id: "undated", status_history: [{status: "approved", changed_at: "invalid"}]})
  ], {now, range: {start: "2026-10-02", end: "2026-10-04"}});
  assert.equal(report.issues.length, 4);
  assert.deepEqual(report.periodIssues.map(item => item.quote.id), ["period"]);
  assert.deepEqual(report.undatedIssues.map(item => item.quote.id), ["undated"]);
  assert.equal(report.workedQuotes, 0);
});
