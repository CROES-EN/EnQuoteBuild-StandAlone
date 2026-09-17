/**
 * Parser for the O&M Email Backlog reports ("Pronto Metrics Dashboard" exports) - built and
 * verified against real exported files before this was written:
 *   - "...Email Metrics_Email Raw Data_....csv" - one row per case (922 real rows confirmed),
 *     columns: Case Origin, Full Name, Created Date, createdDate_PST, Case Number, Account
 *     Name, Name, Case Category, Case Type, Subject, Status, Closed?, Closed Date, Age.
 *   - "...Email Metrics_Daily Email Volume & AHT_....xlsx" - Sheet 2 ("2_Daily Email Volume &
 *     AHT_Deta[il]") has one row per calendar day: Record Type, createdDate_PST (Excel serial
 *     date), # Emails, AHT (hours).
 *
 * Confirmed via direct verification against real data before this file was written:
 *   - "Age" is NOT handle time - it is the number of days between a case's Created Date and
 *     the moment the report was run, calculated the SAME way for both open and closed cases
 *     (i.e. a case closed in 7 minutes back on 7/1 still shows a large Age, because Age
 *     reflects how long ago it was created, not how long it took to resolve). Confirmed
 *     against 3 independent rows (both open and closed) - all matched the same formula within
 *     ~2 minutes (negligible rounding from the report's exact run timestamp).
 *   - Summing "# Emails" across every day in the Daily file's Detail sheet reproduces the
 *     Grand Total's "# Emails Cases" value EXACTLY (922 = 922).
 *   - The emails-weighted average of daily AHT values reproduces the Grand Total's "Average
 *     Email Handle Time" value almost exactly (2.8258 vs 2.8249 hours - a rounding-level
 *     match, not a coincidence), confirming AHT is a real, trustworthy per-day average.
 *   - Real Status values confirmed: "Closed", "New", "Updated by Client", "Follow Up Needed",
 *     "Tier 1 In Progress" - "Closed?" is a separate true/false flag that reliably identifies
 *     open vs. closed (817 Closed / 105 Open confirmed against real data).
 *   - "Full Name" (case owner) is blank on 389 of 922 rows (cases with no specific assigned
 *     owner) - this is expected/normal, not a data quality problem; handled as null throughout.
 */

// ---------------------------------------------------------------------------
// Low-level parsing helpers (self-contained - no dependency on other parser files)
// ---------------------------------------------------------------------------

function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Strips a UTF-8 byte-order-mark if present - confirmed present at the start of the real
 *  Email Raw Data export (\uFEFF before the first header). Without stripping this, the first
 *  column's header/values would silently fail to match by name. */
function stripBom(text) {
  if (text && text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/** Parses a "M/D/YY H:MM:SS AM/PM" timestamp (the exact format confirmed in Created
 *  Date/Closed Date, e.g. "7/1/26 2:51:07 PM") into an ISO "YYYY-MM-DD" date string plus the
 *  full parsed Date object, for range filtering and display. Returns nulls if unparseable. */
function parseUsDateTime(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { isoDate: null, dateObj: null };

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return { isoDate: null, dateObj: null };

  const [, monthStr, dayStr, yearStr, hourStr, minStr, secStr, ampm] = match;
  let year = Number.parseInt(yearStr, 10);
  if (yearStr.length === 2) year += 2000;
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  let hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minStr, 10);
  const second = Number.parseInt(secStr, 10);

  if (ampm) {
    const isPm = ampm.toUpperCase() === "PM";
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }

  const dateObj = new Date(year, month - 1, day, hour, minute, second);
  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { isoDate, dateObj };
}

function parseFloatOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const num = Number.parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

/** Converts an Excel serial date number (e.g. 46204) into an ISO "YYYY-MM-DD" string - used
 *  for the Daily Volume & AHT file's createdDate_PST column, which Excel stores as a serial
 *  number rather than a formatted date string. Verified against real data: serial 46204 =
 *  2026-07-01, serial 46274 = 2026-09-09, matching the confirmed 7/1-9/9 reporting window. */
function excelSerialToIsoDate(serial) {
  const num = Number.parseFloat(serial);
  if (!Number.isFinite(num)) return null;
  const msPerDay = 86400000;
  // Excel's epoch is 1899-12-30 (accounts for Excel's intentional leap-year bug).
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + num * msPerDay);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Email Raw Data parser (case-level detail - one row per case)
// ---------------------------------------------------------------------------

/**
 * Parses the raw "Email Raw Data" CSV into typed, per-case records. Column count is detected
 * dynamically from the header row's real length (same robustness pattern already proven
 * necessary for the OM Staffing Report earlier this session, where NICE changed schema
 * multiple times) - if this report ever gains/loses a column, this keeps working without a
 * code change, since every field is looked up BY HEADER NAME, not position.
 *
 * @param {string} csvText - Raw CSV file content.
 * @returns {Array<Object>} One record per case, e.g.:
 *   {
 *     caseNumber: "20178137",
 *     ownerName: null,               // blank "Full Name" -> null, not ""
 *     accountName: "Pronto Residential Platform Account 1",
 *     contactName: "Docusign Account",
 *     caseCategory: "General",
 *     caseType: "Other",
 *     subject: "Verify a New Device",
 *     status: "Closed",
 *     isClosed: true,
 *     createdDateIso: "2026-07-01",
 *     createdDateObj: Date,
 *     closedDateIso: "2026-07-01",
 *     ageDays: 69.38116898148148,
 *     caseOrigin: "Email"
 *   }
 */
export function parseEmailBacklogRawData(csvText) {
  const cleaned = stripBom(String(csvText ?? ""));
  const lines = cleaned.split(/\r\n|\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const headerFields = splitCsvLine(lines[0]).map((h) => h.trim());
  let lastMeaningfulColumn = -1;
  headerFields.forEach((value, index) => {
    if (value !== "") lastMeaningfulColumn = index;
  });
  const columnCount = lastMeaningfulColumn + 1;
  const headers = headerFields.slice(0, columnCount);
  const colIndex = (label) => headers.indexOf(label);

  const COL = {
    CASE_ORIGIN: colIndex("Case Origin"),
    FULL_NAME: colIndex("Full Name"),
    CREATED_DATE: colIndex("Created Date"),
    CASE_NUMBER: colIndex("Case Number"),
    ACCOUNT_NAME: colIndex("Account Name"),
    NAME: colIndex("Name"),
    CASE_CATEGORY: colIndex("Case Category"),
    CASE_TYPE: colIndex("Case Type"),
    SUBJECT: colIndex("Subject"),
    STATUS: colIndex("Status"),
    CLOSED_FLAG: colIndex("Closed?"),
    CLOSED_DATE: colIndex("Closed Date"),
    AGE: colIndex("Age")
  };

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]).slice(0, columnCount);
    const caseNumber = String(fields[COL.CASE_NUMBER] ?? "").trim();

    // Defensive skip: a real case row always has a case number - anything else (a stray
    // blank line, an unexpected total row NICE-style reports sometimes append) is skipped
    // rather than imported as a corrupt/fake case.
    if (!caseNumber) continue;

    const ownerNameRaw = String(fields[COL.FULL_NAME] ?? "").trim();
    const created = parseUsDateTime(fields[COL.CREATED_DATE]);
    const closed = parseUsDateTime(fields[COL.CLOSED_DATE]);
    const closedFlagRaw = String(fields[COL.CLOSED_FLAG] ?? "").trim().toLowerCase();

    records.push({
      caseNumber,
      ownerName: ownerNameRaw || null,
      accountName: String(fields[COL.ACCOUNT_NAME] ?? "").trim() || null,
      contactName: String(fields[COL.NAME] ?? "").trim() || null,
      caseCategory: String(fields[COL.CASE_CATEGORY] ?? "").trim() || null,
      caseType: String(fields[COL.CASE_TYPE] ?? "").trim() || null,
      subject: String(fields[COL.SUBJECT] ?? "").trim() || null,
      status: String(fields[COL.STATUS] ?? "").trim() || null,
      isClosed: closedFlagRaw === "true",
      createdDateIso: created.isoDate,
      createdDateObj: created.dateObj,
      closedDateIso: closed.isoDate,
      ageDays: parseFloatOrNull(fields[COL.AGE]),
      caseOrigin: String(fields[COL.CASE_ORIGIN] ?? "").trim() || null
    });
  }

  return records;
}

/**
 * Converts already-stored Email Raw Data rows (as saved via ImportAsTableDialog.jsx, keyed by
 * column label) back into the same typed record shape parseEmailBacklogRawData() produces -
 * for reading back data already imported, same pattern as every other report type this
 * session (staffing, etc.).
 */
export function getEmailBacklogRecordsFromStoredRows(storedRows) {
  return (storedRows || [])
    .map((row) => {
      const caseNumber = String(row["Case Number"] ?? "").trim();
      if (!caseNumber) return null;

      const ownerNameRaw = String(row["Full Name"] ?? "").trim();
      const created = parseUsDateTime(row["Created Date"]);
      const closed = parseUsDateTime(row["Closed Date"]);
      const closedFlagRaw = String(row["Closed?"] ?? "").trim().toLowerCase();

      return {
        caseNumber,
        ownerName: ownerNameRaw || null,
        accountName: String(row["Account Name"] ?? "").trim() || null,
        contactName: String(row["Name"] ?? "").trim() || null,
        caseCategory: String(row["Case Category"] ?? "").trim() || null,
        caseType: String(row["Case Type"] ?? "").trim() || null,
        subject: String(row["Subject"] ?? "").trim() || null,
        status: String(row["Status"] ?? "").trim() || null,
        isClosed: closedFlagRaw === "true",
        createdDateIso: created.isoDate,
        createdDateObj: created.dateObj,
        closedDateIso: closed.isoDate,
        ageDays: parseFloatOrNull(row["Age"]),
        caseOrigin: String(row["Case Origin"] ?? "").trim() || null
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Daily Email Volume & AHT parser (one row per calendar day)
// ---------------------------------------------------------------------------

/**
 * Parses the "Daily Email Volume & AHT" export's Detail data into one record per calendar
 * day. Expects rows shaped like {"Record Type": "...", "createdDate_PST": "2026-07-01" (or an
 * Excel serial number), "# Emails": "14", "AHT": "4.53..."} - the exact shape produced once
 * the underlying .xlsx Detail sheet has been read into row objects (e.g. via the existing
 * xlsx-reading utilities already used elsewhere in this app for other imports).
 *
 * @param {Array<Record<string, any>>} rows - row objects from the Daily Detail sheet.
 * @returns {Array<Object>} One record per day, e.g.:
 *   { date: "2026-07-01", emailCount: 14, avgHandleTimeHours: 4.532887731481481 }
 */
export function parseEmailBacklogDailyRows(rows) {
  return (rows || [])
    .map((row) => {
      const rawDate = row["createdDate_PST"];
      // Handles BOTH a plain "YYYY-MM-DD"/"M/D/YYYY" string (if the sheet was already read as
      // formatted dates) AND a raw Excel serial number (if read as raw cell values) - verified
      // necessary since this file's real Detail sheet stores this column as a serial number.
      let date = null;
      const asNumber = Number.parseFloat(rawDate);
      if (Number.isFinite(asNumber) && String(rawDate).trim() === String(asNumber)) {
        date = excelSerialToIsoDate(asNumber);
      } else {
        const trimmed = String(rawDate ?? "").trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
          date = trimmed.slice(0, 10);
        } else {
          const parsed = parseUsDateTime(trimmed + " 12:00:00");
          date = parsed.isoDate;
        }
      }

      const emailCount = parseFloatOrNull(row["# Emails"]);
      const avgHandleTimeHours = parseFloatOrNull(row["AHT"]);

      if (!date || emailCount === null) return null;

      return { date, emailCount, avgHandleTimeHours };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Aggregation for Executive Overview tiles
// ---------------------------------------------------------------------------

/**
 * Computes team-wide Email Backlog totals for a set of daily volume/AHT records already
 * filtered to the active Reporting Period, PLUS backlog-specific figures computed directly
 * from the case-level records (which are NOT date-filtered by Created Date, since backlog age
 * is inherently a "right now" snapshot, not something that makes sense to scope to a
 * historical range - an open case from 3 months ago is still part of today's backlog
 * regardless of which Reporting Period is selected on Executive Overview).
 *
 * @param {Array<Object>} rangedDailyRecords - output of parseEmailBacklogDailyRows(), already
 *   filtered to the active Reporting Period.
 * @param {Array<Object>} allCaseRecords - FULL, unfiltered output of
 *   parseEmailBacklogRawData()/getEmailBacklogRecordsFromStoredRows() - always the complete
 *   case list, regardless of Reporting Period, since backlog age is a live snapshot.
 */
export function computeEmailBacklogTotals(rangedDailyRecords, allCaseRecords) {
  const totalEmails = rangedDailyRecords.reduce((total, r) => total + (r.emailCount ?? 0), 0);

  // Emails-weighted average AHT across the period - verified this reproduces the report's own
  // Grand Total AHT almost exactly (2.8258 vs. 2.8249 hours) when applied across the full range.
  const weightedAhtSum = rangedDailyRecords.reduce((total, r) => {
    if (r.avgHandleTimeHours === null || r.emailCount === null) return total;
    return total + r.avgHandleTimeHours * r.emailCount;
  }, 0);
  const avgHandleTimeHours = totalEmails > 0 ? weightedAhtSum / totalEmails : null;

  const openCases = (allCaseRecords || []).filter((c) => !c.isClosed);
  const openBacklogCount = openCases.length;

  const oldestOpenAgeDays = openCases.reduce((max, c) => {
    if (c.ageDays === null) return max;
    return max === null || c.ageDays > max ? c.ageDays : max;
  }, null);

  // Backlog aging buckets - a direct, at-a-glance view of how much of the open backlog is
  // recent vs. genuinely stale, using the same day thresholds already familiar from standard
  // case-aging conventions (0-7, 8-14, 15-30, 30+).
  const agingBuckets = { days0to7: 0, days8to14: 0, days15to30: 0, days30plus: 0 };
  openCases.forEach((c) => {
    if (c.ageDays === null) return;
    if (c.ageDays <= 7) agingBuckets.days0to7 += 1;
    else if (c.ageDays <= 14) agingBuckets.days8to14 += 1;
    else if (c.ageDays <= 30) agingBuckets.days15to30 += 1;
    else agingBuckets.days30plus += 1;
  });

  return {
    totalEmails,
    avgHandleTimeHours,
    openBacklogCount,
    oldestOpenAgeDays,
    agingBuckets
  };
}