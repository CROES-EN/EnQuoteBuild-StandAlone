/**
 * Enphase Care eligibility logic - determines whether a homeowner at a given Enlighten Site ID
 * currently has ACTIVE Enphase Care coverage, based on the imported Care Subscriptions report
 * (Report Data tab, reportType "care_subscriptions"). This is the single source of truth used
 * by both the Care Data Hygiene report and, eventually, the Quote Form eligibility badge - both
 * must call the same functions here so they can never disagree with each other.
 *
 * DATA HYGIENE RULES (confirmed by the user, not guessed):
 *
 * 1. HIDDEN status = internal test record - always excluded from eligibility.
 * 2. Any Customer Email ending in "@enphaseenergy.com" = internal staff self-test - excluded,
 *    even though some of these are real Enphase employees, per explicit user decision to keep
 *    the exclusion rule simple and unambiguous rather than carve out an edge case.
 * 3. Obvious placeholder test names/emails/phone numbers (Test Tester, John Doe##, 555-5555,
 *    etc.) - excluded.
 * 4. Duplicate Site IDs are NOT a conflict - they represent renewal history. Every real record
 *    is kept; the most recent (by Created Dt) is treated as "current" for eligibility, and the
 *    full history is preserved and exposed for review, never silently discarded.
 * 5. A Site ID with zero real (non-excluded) records is NOT_FOUND, not "assumed inactive" -
 *    this is the honest, conservative default requested: when in doubt, say so, don't guess.
 *
 * The exact column names below were confirmed directly from the real source file, including
 * the "Enlighten Site Id" capitalization (lowercase "d"), which differs from "Enlighten Site
 * ID" used elsewhere in this feature - the two must not be confused.
 */

const SITE_ID_COLUMN = "Enlighten Site Id";
const STATUS_COLUMN = "Subscription Status";
const EMAIL_COLUMN = "Customer Email";
const FIRST_NAME_COLUMN = "Customer First Name";
const LAST_NAME_COLUMN = "Customer Last Name";
const PHONE_COLUMN = "Customer Phone";
const CREATED_COLUMN = "Created Dt";
const RENEWAL_COLUMN = "Renewal Date";
const PLAN_COLUMN = "Plan Name";

const ACTIVE_STATUS = "ACTIVE";
const HIDDEN_STATUS = "HIDDEN";

const PLACEHOLDER_NAME_PATTERNS = [
  /^test$/i,
  /^tester$/i,
  /^testing$/i,
  /^john\s*doe\d*$/i,
  /^jane\s*doe\d*$/i,
  /test\s*user/i
];

function normalize(value) {
  return String(value ?? "").trim();
}

function isPlaceholderName(value) {
  const trimmed = normalize(value);
  if (!trimmed) return false;
  return PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Returns true if this row should be excluded from eligibility checks as an internal test or
 * staff self-test record, per the confirmed rules above. Exported separately from the main
 * eligibility function so the Data Hygiene report can show the user exactly which rows were
 * excluded and why, rather than only a final count.
 */
export function isExcludedTestRecord(row) {
  const status = normalize(row[STATUS_COLUMN]).toUpperCase();
  if (status === HIDDEN_STATUS) {
    return { excluded: true, reason: "Status is HIDDEN (internal test)" };
  }

  const email = normalize(row[EMAIL_COLUMN]).toLowerCase();
  if (email.endsWith("@enphaseenergy.com")) {
    return { excluded: true, reason: "Internal Enphase staff email" };
  }
  if (email.includes("+test") || email.includes("test@") || email.includes("@testing.com")) {
    return { excluded: true, reason: "Test email pattern" };
  }

  const firstName = row[FIRST_NAME_COLUMN];
  const lastName = row[LAST_NAME_COLUMN];
  if (isPlaceholderName(firstName) || isPlaceholderName(lastName)) {
    return { excluded: true, reason: "Placeholder test name" };
  }

  const phone = normalize(row[PHONE_COLUMN]);
  if (phone.includes("555-5555")) {
    return { excluded: true, reason: "Placeholder test phone number" };
  }

  return { excluded: false, reason: null };
}

/**
 * Splits all imported Care Subscription rows into real customer records and excluded
 * test/internal records, with the specific reason each excluded row was flagged. Used by both
 * the Data Hygiene report (to show counts and let the user review exclusions) and internally
 * by getEligibilityForSiteId below.
 */
export function classifyCareSubscriptionRows(rows) {
  const realRecords = [];
  const excludedRecords = [];

  (rows || []).forEach((row) => {
    const check = isExcludedTestRecord(row);
    if (check.excluded) {
      excludedRecords.push({ row, reason: check.reason });
    } else {
      realRecords.push(row);
    }
  });

  return { realRecords, excludedRecords };
}

function parseDateValue(value) {
  const trimmed = normalize(value);
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Groups real (already-excluded-filtered) records by Site ID, sorted newest-first by Created
 * Dt within each group. A record with a missing/unparseable Created Dt is sorted to the end of
 * its group (treated as oldest) rather than thrown out, since the row itself is still real
 * customer data worth keeping visible.
 */
export function groupRealRecordsBySiteId(realRecords) {
  const groups = new Map();

  realRecords.forEach((row) => {
    const siteId = normalize(row[SITE_ID_COLUMN]);
    if (!siteId) return; // handled separately as "missing site id" - see findMissingSiteIdRecords
    if (!groups.has(siteId)) groups.set(siteId, []);
    groups.get(siteId).push(row);
  });

  groups.forEach((records, siteId) => {
    records.sort((a, b) => {
      const dateA = parseDateValue(a[CREATED_COLUMN]);
      const dateB = parseDateValue(b[CREATED_COLUMN]);
      if (dateA && dateB) return dateB.getTime() - dateA.getTime();
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      return 0;
    });
    groups.set(siteId, records);
  });

  return groups;
}

/** Real customer records that have no Site ID at all - needs manual follow-up, never silently dropped. */
export function findMissingSiteIdRecords(realRecords) {
  return realRecords.filter((row) => !normalize(row[SITE_ID_COLUMN]));
}

/**
 * Builds a fast lookup index (Site ID -> that site's real-record history, newest first) from
 * the full imported Care Subscriptions rows - call this ONCE (e.g. via useMemo keyed on the
 * rows themselves), not per-row, since it internally re-classifies/re-groups every row. This
 * is the exact same real-records grouping getEligibilityForSiteId itself uses - kept as a
 * separate export so a caller checking eligibility for MANY rows in a loop (e.g. every row of
 * a Workload report) can build the index once and do a cheap Map lookup per row via
 * getEligibilityFromIndex below, instead of paying the full classify+group cost on every
 * single row.
 */
export function buildCareEligibilityIndex(allCareSubscriptionRows) {
  const { realRecords } = classifyCareSubscriptionRows(allCareSubscriptionRows || []);
  return groupRealRecordsBySiteId(realRecords);
}

/**
 * Same three-state result (ACTIVE_CARE / NO_ACTIVE_CARE / NOT_FOUND) as
 * getEligibilityForSiteId, but reads from an already-built index (see
 * buildCareEligibilityIndex above) instead of re-classifying/re-grouping the full rows list
 * every call - use this for repeated per-row lookups against the same underlying data.
 */
export function getEligibilityFromIndex(siteId, index) {
  const targetSiteId = normalize(siteId);
  if (!targetSiteId) {
    return { status: "NOT_FOUND", reason: "no_site_id_provided", current: null, history: [] };
  }

  const history = index.get(targetSiteId) || [];
  if (history.length === 0) {
    return { status: "NOT_FOUND", reason: "no_subscription_record", current: null, history: [] };
  }

  const current = history[0];
  const currentStatus = normalize(current[STATUS_COLUMN]).toUpperCase();
  const renewalCount = history.length - 1;

  if (currentStatus === ACTIVE_STATUS) {
    return {
      status: "ACTIVE_CARE",
      reason: null,
      current: {
        planName: current[PLAN_COLUMN],
        renewalDate: current[RENEWAL_COLUMN],
        createdDate: current[CREATED_COLUMN],
        subscriptionStatus: currentStatus
      },
      renewalCount,
      history
    };
  }

  return {
    status: "NO_ACTIVE_CARE",
    reason: currentStatus === "EXPIRED" ? "expired" : (currentStatus === "CANCELLED" ? "cancelled" : "inactive"),
    current: {
      planName: current[PLAN_COLUMN],
      subscriptionStatus: currentStatus,
      createdDate: current[CREATED_COLUMN]
    },
    renewalCount,
    history
  };
}

/**
 * Core eligibility check for a single Site ID. Always returns one of three honest states -
 * ACTIVE_CARE, NO_ACTIVE_CARE, or NOT_FOUND - and NEVER guesses ACTIVE_CARE when data is
 * ambiguous or absent. Includes the full renewal history (every real record for this Site ID,
 * newest first) so callers can show "3rd renewal" style context, per the user's explicit
 * request to keep and surface renewal history rather than collapse it away.
 *
 * @param {string} siteId
 * @param {Array<Record<string, any>>} allCareSubscriptionRows - the raw imported rows exactly
 *   as stored in importedTableStore.js for reportType "care_subscriptions"
 */
export function getEligibilityForSiteId(siteId, allCareSubscriptionRows) {
  const targetSiteId = normalize(siteId);
  if (!targetSiteId) {
    return { status: "NOT_FOUND", reason: "no_site_id_provided", current: null, history: [] };
  }

  const { realRecords } = classifyCareSubscriptionRows(allCareSubscriptionRows);
  const groups = groupRealRecordsBySiteId(realRecords);
  const history = groups.get(targetSiteId) || [];

  if (history.length === 0) {
    return { status: "NOT_FOUND", reason: "no_subscription_record", current: null, history: [] };
  }

  const current = history[0];
  const currentStatus = normalize(current[STATUS_COLUMN]).toUpperCase();
  const renewalCount = history.length - 1;

  if (currentStatus === ACTIVE_STATUS) {
    return {
      status: "ACTIVE_CARE",
      reason: null,
      current: {
        planName: current[PLAN_COLUMN],
        renewalDate: current[RENEWAL_COLUMN],
        createdDate: current[CREATED_COLUMN],
        subscriptionStatus: currentStatus
      },
      renewalCount,
      history
    };
  }

  return {
    status: "NO_ACTIVE_CARE",
    reason: currentStatus === "EXPIRED" ? "expired" : (currentStatus === "CANCELLED" ? "cancelled" : "inactive"),
    current: {
      planName: current[PLAN_COLUMN],
      subscriptionStatus: currentStatus,
      createdDate: current[CREATED_COLUMN]
    },
    renewalCount,
    history
  };
}

/**
 * Full hygiene summary across the entire imported Care Subscriptions table - powers the Data
 * Hygiene report view. Computed once and reused, rather than recalculated ad hoc, so the
 * numbers shown to the user are always internally consistent with what getEligibilityForSiteId
 * would actually return for any given Site ID.
 */
export function computeCareDataHygieneSummary(allCareSubscriptionRows) {
  const rows = allCareSubscriptionRows || [];
  const { realRecords, excludedRecords } = classifyCareSubscriptionRows(rows);
  const missingSiteIdRecords = findMissingSiteIdRecords(realRecords);
  const groups = groupRealRecordsBySiteId(realRecords);

  let activeCount = 0;
  let expiredCount = 0;
  let cancelledCount = 0;
  let otherCount = 0;
  let renewalSiteCount = 0;

  groups.forEach((history) => {
    const currentStatus = normalize(history[0][STATUS_COLUMN]).toUpperCase();
    if (currentStatus === "ACTIVE") activeCount += 1;
    else if (currentStatus === "EXPIRED") expiredCount += 1;
    else if (currentStatus === "CANCELLED") cancelledCount += 1;
    else otherCount += 1;

    if (history.length > 1) renewalSiteCount += 1;
  });

  // Reasons are collapsed to counts here for the summary view; excludedRecords itself retains
  // the row + reason pairing for a detailed "View excluded rows" drill-down.
  const exclusionReasonCounts = {};
  excludedRecords.forEach(({ reason }) => {
    exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] || 0) + 1;
  });

  return {
    totalRowsImported: rows.length,
    excludedCount: excludedRecords.length,
    excludedRecords,
    exclusionReasonCounts,
    realRecordCount: realRecords.length,
    uniqueSiteIdCount: groups.size,
    renewalSiteCount,
    missingSiteIdRecords,
    statusBreakdown: {
      ACTIVE: activeCount,
      EXPIRED: expiredCount,
      CANCELLED: cancelledCount,
      OTHER: otherCount
    }
  };
}

