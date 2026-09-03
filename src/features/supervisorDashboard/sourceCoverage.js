/**
 * Source-group coverage for the Executive Overview - "does this reporting period actually have
 * data for each operational area", per the O&M reporting spec's Source Coverage requirements.
 *
 * A source group counts as having data for a date when at least one meaningful field it owns is
 * a valid non-null value on that date's record - including zero, which is always valid data, per
 * spec. This module never claims a file was imported unless `record.sources` actually says so
 * (see `opsMetricsStore.js`'s `sources` map) - it only ever reports "Metric Data Available" when
 * presence is inferred from field values alone.
 */

// Mirrors the field groups DashboardOverview.jsx already used for its per-tab "freshness" check -
// kept here so period-wide coverage and single-day freshness use one shared definition.
export const SOURCE_GROUPS = [
  {
    key: "contact_center",
    label: "Contact Center",
    fields: [
      "calls_offered", "calls", "calls_abandoned", "aht_seconds", "avg_wait_seconds",
      "emails_received", "emails_worked", "email_backlog_start", "email_backlog_end"
    ],
    importSourceKeys: ["cxone"],
    configured: true
  },
  {
    key: "staffing",
    label: "Staffing",
    fields: [
      "team_headcount", "staffing_present", "staffing_scheduled", "full_day_absences",
      "partial_day_absences", "training_capacity_loss", "scheduled_productive_hours", "actual_productive_hours"
    ],
    importSourceKeys: ["nice_wfm"],
    configured: true
  },
  {
    key: "quote_operations",
    label: "Quote Operations",
    fields: ["sf_quotes_received", "quotes_drafted"],
    importSourceKeys: ["salesforce"],
    configured: true,
    // Quote Operations also has live-computed EnQuote figures (quoteOpsMetrics.js) independent of
    // any stored field - callers may pass `quoteOpsHasDataByDate` so a date with live-computed
    // Quotes Drafted/Completed still counts as covered even if no report was ever imported for it.
    liveComputed: true
  },
  {
    key: "case_backlog",
    label: "Case Backlog",
    fields: ["case_backlog_start", "case_backlog_end", "new_cases_received", "cases_completed"],
    importSourceKeys: ["incorta"],
    configured: true
  },
  {
    key: "field_service",
    label: "Field Service",
    fields: [],
    importSourceKeys: [],
    // No verified source-file schema exists yet for Field Service Appointment reports (see
    // reportDefinitions.js's "field_service_appointment" stub) - this group is intentionally
    // always "Setup Required" rather than fabricating fields or showing a misleading 0% coverage.
    configured: false
  },
  {
    key: "enphase_care",
    label: "Enphase Care",
    fields: ["care_appt_cancellations", "care_plan_cancellation_requests", "care_cancellations_completed", "care_refunds_initiated"],
    importSourceKeys: ["care_tracker"],
    configured: true
  },
  {
    key: "escalations",
    label: "Escalations",
    fields: ["new_s1", "new_s2", "new_s3", "open_critical_escalations", "overdue_follow_ups", "major_blockers", "leadership_action_required", "travel_field_blockers"],
    importSourceKeys: ["escalations_tracker"],
    configured: true
  }
];

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return !Number.isNaN(value);
}

function recordHasGroupData(record, group, quoteOpsHasDataByDate) {
  const hasField = group.fields.some(fieldKey => hasMeaningfulValue(record?.[fieldKey]));
  if (hasField) return true;
  if (group.liveComputed && quoteOpsHasDataByDate?.[record?.date]) return true;
  return false;
}

/** Latest `sources[key].imported_at` (real import timestamps only - never manual) across `records`. */
function latestImportTimestamp(records, importSourceKeys) {
  if (!importSourceKeys?.length) return null;
  let latest = null;
  for (const record of records || []) {
    for (const key of importSourceKeys) {
      const importedAt = record?.sources?.[key]?.imported_at;
      if (importedAt && (!latest || importedAt > latest)) latest = importedAt;
    }
  }
  return latest;
}

/**
 * Coverage for one source group across `records` (already filtered to the selected range).
 * `quoteOpsHasDataByDate` is an optional `{ [date]: boolean }` map for the Quote Operations
 * group's live-computed figures (see quoteOpsMetrics.js) - dates the caller has confirmed have a
 * live-computed Quotes Drafted/Completed count as covered even with no imported/manual field.
 */
export function computeGroupCoverage(records, group, { quoteOpsHasDataByDate } = {}) {
  const totalSnapshots = (records || []).length;

  if (!group.configured) {
    return {
      key: group.key,
      label: group.label,
      snapshotsWithData: 0,
      snapshotsWithoutData: totalSnapshots,
      coveragePercent: null,
      latestDateWithData: null,
      latestImportAt: null,
      status: "Setup Required"
    };
  }

  const withData = (records || []).filter(record => recordHasGroupData(record, group, quoteOpsHasDataByDate));
  const snapshotsWithData = withData.length;
  const latestDateWithData = withData.map(r => r.date).sort().slice(-1)[0] || null;
  const latestImportAt = latestImportTimestamp(records, group.importSourceKeys);

  let status = "No Data";
  if (totalSnapshots > 0 && snapshotsWithData === totalSnapshots) status = "Full Coverage";
  else if (snapshotsWithData > 0) status = "Partial Coverage";

  return {
    key: group.key,
    label: group.label,
    snapshotsWithData,
    snapshotsWithoutData: totalSnapshots - snapshotsWithData,
    // 0% (a real number) when this group is configured but the range simply has no stored
    // snapshots at all - `null` is reserved for "Setup Required" (the early return above), so
    // callers can distinguish "genuinely no data yet" from "not configured to import" instead of
    // mislabeling an empty-but-configured source as Setup Required.
    coveragePercent: totalSnapshots > 0 ? Math.round((snapshotsWithData / totalSnapshots) * 1000) / 10 : 0,
    latestDateWithData,
    latestImportAt,
    status
  };
}

/** Coverage for every source group across the selected range's records. */
export function computeSourceCoverage(records, options = {}) {
  return SOURCE_GROUPS.map(group => computeGroupCoverage(records, group, options));
}

/**
 * Overall period coverage = fraction of (configured group x stored snapshot) cells that actually
 * have data, across every configured group - not just an unweighted average of each group's own
 * percentage, so a group with many stored days counts proportionally more.
 */
export function computeOverallCoverage(groupResults) {
  const configured = (groupResults || []).filter(group => group.status !== "Setup Required");
  const totalCells = configured.reduce((sum, group) => sum + group.snapshotsWithData + group.snapshotsWithoutData, 0);
  if (totalCells === 0) return null;
  const coveredCells = configured.reduce((sum, group) => sum + group.snapshotsWithData, 0);
  return Math.round((coveredCells / totalCells) * 1000) / 10;
}

/** Records belonging to one source group (for the coverage table's "View Records" drill-down). */
export function getRecordsForGroup(records, groupKey, { quoteOpsHasDataByDate } = {}) {
  const group = SOURCE_GROUPS.find(g => g.key === groupKey);
  if (!group || !group.configured) return [];
  return (records || []).filter(record => recordHasGroupData(record, group, quoteOpsHasDataByDate));
}
