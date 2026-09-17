/**
 * Parser for the new custom NICE CXone "OM Report" (Contact Summary / Agent perspective /
 * 1 Day interval, filtered to Team Name = Boise Aux|Todd Meyer|OM).
 *
 * This REPLACES parseSupervisorSnapshotCsv.js entirely, per user confirmation this custom
 * report replaces the old "Supervisor Snapshot" export. Unlike the old parser, this file
 * needs NO section-detection logic - NICE's custom report builder exports one single clean
 * table with exactly the columns the user selected, so this parser is a straightforward
 * column-mapped CSV import, matching the pattern already used for other Report Data types
 * (SFDC-Quotes, Incorta-O&M-Input).
 *
 * Confirmed column order (from two real sample exports, 2026-07-01 through 2026-09-09):
 *   Date, Agent Name, Agent ID, Team Name, Login Time, ACD Contacts, Answered, Handle Time,
 *   Talk Time, ACW Time, Unavailable Time, % Unavailable Time, Avg ACW Time, Avg Talk Time,
 *   Refusals, Held Party Abandons, Transfer to Agent, Unavailable Time minus ACW,
 *   Working Rate, Productivity Rate, Hold Time
 *
 * Confirmed facts about this data (verified against real exports, do not re-derive):
 *   - Handle Time = Talk Time + ACW Time (confirmed across dozens of rows, ~1sec rounding
 *     noise only). Hold Time is a sub-component WITHIN Talk Time (time on hold during a
 *     call), NOT additive to Handle Time - do not add Hold Time when reconciling totals.
 *   - Occupancy and Productivity Rate are both structurally broken in this report
 *     configuration (flat 100.00% on every row, zero exceptions across ~350+ rows) -
 *     NEVER use either for utilization calculations. Productivity Rate is still present as
 *     an exported column (NICE always includes it) but is intentionally ignored below.
 *   - Working Rate is the correct utilization signal - it varies meaningfully and tracks
 *     inversely with % Unavailable Time (Working Rate ~= 100% - % Unavailable Time).
 *   - Unavailable Time minus ACW correctly isolates real break/meeting/idle time from
 *     wrap-up work (verified: Unavailable Time - ACW Time = Unavailable Time minus ACW,
 *     exactly, in every checked row).
 *   - The file ends with a "Grand Total" summary row (Date === "Grand Total", blank Agent
 *     Name/ID/Team Name) - this MUST be excluded, never treated as a real agent-day record.
 *   - Confirmed roster (9 agents) exactly matches the real team: Ankenman, Bermudez, Davis,
 *     Frederick, Haumann, Lasley, Roeschberger, Seganos, Wilson.
 */

// ---------------------------------------------------------------------------
// Low-level parsing helpers
// ---------------------------------------------------------------------------

/** Parses a "H:MM:SS" or "HH:MM:SS" duration string into total seconds. Returns null for
 *  blank/missing values (NICE leaves many cells blank rather than "00:00:00" when a metric
 *  doesn't apply for that agent-day, e.g. an agent with zero hold time all day). */
function parseDurationToSeconds(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return null;
}

/** Parses a "12.34%" string into a numeric percent (12.34). Returns null if blank. */
function parsePercent(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace("%", "");
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Parses an integer count. Returns null (not 0) for blank cells, since NICE leaves counts
 *  blank rather than 0 when a metric never occurred for that agent-day - preserving this
 *  distinction matters for correctly identifying "no data" vs. "confirmed zero". */
function parseIntOrNull(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const num = Number.parseInt(trimmed, 10);
  return Number.isFinite(num) ? num : null;
}

/** Very small, dependency-free CSV line splitter that respects double-quoted fields
 *  containing commas (e.g. "Bermudez, Amir"). Not a full RFC-4180 parser, but sufficient
 *  for NICE's export format (quotes only ever wrap the Agent Name field in practice). */
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

// Column indexes, matching the confirmed header order above. Defined as named constants
// (not magic numbers) so a future NICE export column reorder is a one-line fix.
const COL = {
  DATE: 0,
  AGENT_NAME: 1,
  AGENT_ID: 2,
  TEAM_NAME: 3,
  LOGIN_TIME: 4,
  ACD_CONTACTS: 5,
  ANSWERED: 6,
  HANDLE_TIME: 7,
  TALK_TIME: 8,
  ACW_TIME: 9,
  UNAVAILABLE_TIME: 10,
  PCT_UNAVAILABLE_TIME: 11,
  AVG_ACW_TIME: 12,
  AVG_TALK_TIME: 13,
  REFUSALS: 14,
  HELD_PARTY_ABANDONS: 15,
  TRANSFER_TO_AGENT: 16,
  UNAVAILABLE_MINUS_ACW: 17,
  WORKING_RATE: 18,
  // Productivity Rate lives at index 19 in the raw export - intentionally never read here,
  // confirmed structurally broken (flat 100.00% every row). Left undefined on purpose.
  HOLD_TIME: 20
};

/** Converts a NICE "YYYY/MM/DD" date string into the "YYYY-MM-DD" convention used
 *  everywhere else in EnQuote (dateRanges.js, opsMetricsStore.js, etc.). */
function normalizeDate(rawDate) {
  const trimmed = String(rawDate ?? "").trim();
  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses the raw OM Report CSV text into an array of per-agent, per-day records.
 * Excludes the trailing "Grand Total" row and any blank/malformed lines.
 *
 * @param {string} csvText - Raw CSV file content (as read from disk or a File object).
 * @returns {Array<Object>} One record per agent per day, e.g.:
 *   {
 *     date: "2026-07-01",
 *     agentName: "Bermudez, Amir",
 *     agentId: "39000226",
 *     teamName: "Boise Aux|Todd Meyer|OM",
 *     loginTimeSec: 10781,
 *     acdContacts: 9,
 *     answered: 9,
 *     handleTimeSec: 10781,
 *     talkTimeSec: 10563,
 *     acwTimeSec: 218,
 *     holdTimeSec: null,
 *     unavailableTimeSec: 218,
 *     unavailableMinusAcwSec: null,
 *     pctUnavailableTime: 2.02,
 *     workingRatePct: 100.00,
 *     avgAcwTimeSec: 24,
 *     avgTalkTimeSec: 1174,
 *     refusals: null,
 *     heldPartyAbandons: null,
 *     transferToAgent: null
 *   }
 */
export function parseOMStaffingCsv(csvText) {
  const lines = String(csvText ?? "")
    .split(/\r\n|\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  // Skip the header row (line 0); process every subsequent line as a data row.
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const rawDate = fields[COL.DATE];

    // Exclude the trailing NICE "Grand Total" summary row - never a real agent-day.
    if (!rawDate || rawDate.trim().toLowerCase() === "grand total") continue;

    const date = normalizeDate(rawDate);
    const agentName = String(fields[COL.AGENT_NAME] ?? "").trim();
    const agentId = String(fields[COL.AGENT_ID] ?? "").trim();

    // Defensive skip: a real agent-day row always has a date and an agent name/ID. If
    // either is missing this is a malformed/blank line, not real data - skip silently
    // rather than importing a corrupt record.
    if (!date || !agentName || !agentId) continue;

    records.push({
      date,
      agentName,
      agentId,
      teamName: String(fields[COL.TEAM_NAME] ?? "").trim(),
      loginTimeSec: parseDurationToSeconds(fields[COL.LOGIN_TIME]),
      acdContacts: parseIntOrNull(fields[COL.ACD_CONTACTS]),
      answered: parseIntOrNull(fields[COL.ANSWERED]),
      handleTimeSec: parseDurationToSeconds(fields[COL.HANDLE_TIME]),
      talkTimeSec: parseDurationToSeconds(fields[COL.TALK_TIME]),
      acwTimeSec: parseDurationToSeconds(fields[COL.ACW_TIME]),
      holdTimeSec: parseDurationToSeconds(fields[COL.HOLD_TIME]),
      unavailableTimeSec: parseDurationToSeconds(fields[COL.UNAVAILABLE_TIME]),
      unavailableMinusAcwSec: parseDurationToSeconds(fields[COL.UNAVAILABLE_MINUS_ACW]),
      pctUnavailableTime: parsePercent(fields[COL.PCT_UNAVAILABLE_TIME]),
      workingRatePct: parsePercent(fields[COL.WORKING_RATE]),
      avgAcwTimeSec: parseDurationToSeconds(fields[COL.AVG_ACW_TIME]),
      avgTalkTimeSec: parseDurationToSeconds(fields[COL.AVG_TALK_TIME]),
      refusals: parseIntOrNull(fields[COL.REFUSALS]),
      heldPartyAbandons: parseIntOrNull(fields[COL.HELD_PARTY_ABANDONS]),
      transferToAgent: parseIntOrNull(fields[COL.TRANSFER_TO_AGENT])
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Team Counts aggregation (top-level tile view)
// ---------------------------------------------------------------------------

/** Sums an array of possibly-null seconds/counts, treating null as 0 for the sum but not
 *  letting a fully-empty column silently look identical to a column of real zeros
 *  elsewhere - callers needing that distinction should inspect the raw records directly. */
function sumField(records, field) {
  return records.reduce((total, r) => total + (r[field] ?? 0), 0);
}

/**
 * Groups per-agent-day records into one Team Counts row per calendar date.
 * Team Headcount = count of DISTINCT agents with any activity that day (row count per
 * date), which is exactly the row-per-agent-per-day grain this report was designed to
 * produce (no skill dimension in this report, so no multi-counting risk here, unlike the
 * skill-bundled report design floated earlier).
 *
 * @param {Array<Object>} records - Output of parseOMStaffingCsv().
 * @returns {Array<Object>} One row per date, e.g.:
 *   {
 *     date: "2026-07-01",
 *     teamHeadcount: 7,
 *     totalLoginTimeSec: 62345,
 *     totalAcdContacts: 62,
 *     totalAnswered: 60,
 *     totalHandleTimeSec: 61890,
 *     totalTalkTimeSec: 60510,
 *     totalAcwTimeSec: 1380,
 *     totalHoldTimeSec: 421,
 *     totalUnavailableTimeSec: 1401,
 *     totalUnavailableMinusAcwSec: 21,
 *     avgWorkingRatePct: 99.98,
 *     totalRefusals: 0,
 *     totalHeldPartyAbandons: 0,
 *     totalTransferToAgent: 0
 *   }
 */
export function computeTeamDailyTotals(records) {
  const byDate = new Map();
  records.forEach((r) => {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  });

  return Array.from(byDate.entries())
    .map(([date, dayRecords]) => {
      // Weighted average Working Rate (weighted by Login Time) is more representative of
      // true team utilization than a flat average across agents, since a nearly-idle
      // agent's single-digit login time shouldn't count as heavily as a full-shift agent.
      const totalLoginTimeSec = sumField(dayRecords, "loginTimeSec");
      const workingRateWeightedSum = dayRecords.reduce((total, r) => {
        if (r.workingRatePct === null || r.loginTimeSec === null) return total;
        return total + r.workingRatePct * r.loginTimeSec;
      }, 0);
      const avgWorkingRatePct = totalLoginTimeSec > 0
        ? Math.round((workingRateWeightedSum / totalLoginTimeSec) * 100) / 100
        : null;

      return {
        date,
        teamHeadcount: dayRecords.length,
        totalLoginTimeSec,
        totalAcdContacts: sumField(dayRecords, "acdContacts"),
        totalAnswered: sumField(dayRecords, "answered"),
        totalHandleTimeSec: sumField(dayRecords, "handleTimeSec"),
        totalTalkTimeSec: sumField(dayRecords, "talkTimeSec"),
        totalAcwTimeSec: sumField(dayRecords, "acwTimeSec"),
        totalHoldTimeSec: sumField(dayRecords, "holdTimeSec"),
        totalUnavailableTimeSec: sumField(dayRecords, "unavailableTimeSec"),
        totalUnavailableMinusAcwSec: sumField(dayRecords, "unavailableMinusAcwSec"),
        avgWorkingRatePct,
        totalRefusals: sumField(dayRecords, "refusals"),
        totalHeldPartyAbandons: sumField(dayRecords, "heldPartyAbandons"),
        totalTransferToAgent: sumField(dayRecords, "transferToAgent")
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Per-Agent drill-down (detail view for a selected date or date range)
// ---------------------------------------------------------------------------

/**
 * Returns every per-agent record whose date falls within [start, end] (inclusive),
 * sorted alphabetically by agent name - the drill-down feed for a Team Counts tile,
 * following the same filterRecordsInRange pattern already used by dateRanges.js.
 *
 * @param {Array<Object>} records - Output of parseOMStaffingCsv().
 * @param {{start: string, end: string}} range - "YYYY-MM-DD" inclusive bounds.
 */
export function getAgentBreakdownInRange(records, { start, end }) {
  return records
    .filter((r) => r.date && r.date >= start && r.date <= end)
    .sort((a, b) => a.agentName.localeCompare(b.agentName) || a.date.localeCompare(b.date));
}

/**
 * Returns aggregated per-agent totals across a date range - e.g. "how did each agent
 * perform this Reporting Period", rolling up every day into one row per agent. Mirrors
 * computeTeamDailyTotals()'s aggregation logic, but grouped by agent instead of by date.
 */
export function computeAgentTotalsInRange(records, { start, end }) {
  const inRange = getAgentBreakdownInRange(records, { start, end });
  const byAgent = new Map();
  inRange.forEach((r) => {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  });

  return Array.from(byAgent.entries())
    .map(([agentId, agentRecords]) => {
      const totalLoginTimeSec = sumField(agentRecords, "loginTimeSec");
      const workingRateWeightedSum = agentRecords.reduce((total, r) => {
        if (r.workingRatePct === null || r.loginTimeSec === null) return total;
        return total + r.workingRatePct * r.loginTimeSec;
      }, 0);
      const avgWorkingRatePct = totalLoginTimeSec > 0
        ? Math.round((workingRateWeightedSum / totalLoginTimeSec) * 100) / 100
        : null;

      return {
        agentId,
        agentName: agentRecords[0].agentName,
        daysActive: agentRecords.length,
        totalLoginTimeSec,
        totalAcdContacts: sumField(agentRecords, "acdContacts"),
        totalAnswered: sumField(agentRecords, "answered"),
        totalHandleTimeSec: sumField(agentRecords, "handleTimeSec"),
        totalTalkTimeSec: sumField(agentRecords, "talkTimeSec"),
        totalAcwTimeSec: sumField(agentRecords, "acwTimeSec"),
        totalHoldTimeSec: sumField(agentRecords, "holdTimeSec"),
        totalUnavailableTimeSec: sumField(agentRecords, "unavailableTimeSec"),
        totalUnavailableMinusAcwSec: sumField(agentRecords, "unavailableMinusAcwSec"),
        avgWorkingRatePct,
        totalRefusals: sumField(agentRecords, "refusals"),
        totalHeldPartyAbandons: sumField(agentRecords, "heldPartyAbandons"),
        totalTransferToAgent: sumField(agentRecords, "transferToAgent")
      };
    })
    .sort((a, b) => a.agentName.localeCompare(b.agentName));
}

// ---------------------------------------------------------------------------
// Read-back from storage (for Executive Overview Team Counts tiles)
// ---------------------------------------------------------------------------

/**
 * Converts ALREADY-STORED staffing rows (as saved by ImportAsTableDialog.jsx via
 * saveStaffingSnapshot() into importedTableStore.js's "staffing" report table) into the same
 * typed per-agent-day record shape parseOMStaffingCsv() produces from a fresh CSV. Use this to
 * power Team Counts / per-agent aggregates from data that's already been imported and merged
 * across many days - parseOMStaffingCsv() itself is only for parsing a brand-new CSV at import
 * time.
 *
 * Stored rows are keyed by the exact column header labels this report's CSV uses (e.g.
 * row["Agent Name"], row["Login Time"]) - NOT positional array indexes like the raw CSV parser
 * uses - since ImportAsTableDialog.jsx converts each row into a {columnLabel: value} object
 * before saving.
 *
 * @param {Array<Record<string, string>>} storedRows - the "rows" array from
 *   importedTableStore.js's getReportTable("staffing") / listReportTables().staffing.
 */
export function getRecordsFromStoredRows(storedRows) {
  return (storedRows || [])
    .map((row) => {
      const date = normalizeDate(row["Date"]);
      const agentName = String(row["Agent Name"] ?? "").trim();
      const agentId = String(row["Agent ID"] ?? "").trim();
      if (!date || !agentName || !agentId) return null;

      return {
        date,
        agentName,
        agentId,
        teamName: String(row["Team Name"] ?? "").trim(),
        skillId: String(row["Skill ID"] ?? "").trim(),
        unavailableCode: String(row["Unavailable Code"] ?? "").trim(),
        loginTimeSec: parseDurationToSeconds(row["Login Time"]),
        acdContacts: parseIntOrNull(row["ACD Contacts"]),
        answered: parseIntOrNull(row["Answered"]),
        handleTimeSec: parseDurationToSeconds(row["Handle Time"]),
        talkTimeSec: parseDurationToSeconds(row["Talk Time"]),
        acwTimeSec: parseDurationToSeconds(row["ACW Time"]),
        holdTimeSec: parseDurationToSeconds(row["Hold Time"]),
        unavailableTimeSec: parseDurationToSeconds(row["Unavailable Time"]),
        unavailableMinusAcwSec: parseDurationToSeconds(row["Unavailable Time minus ACW"]),
        pctUnavailableTime: parsePercent(row["% Unavailable Time"]),
        workingRatePct: parsePercent(row["Working Rate"]),
        avgAcwTimeSec: parseDurationToSeconds(row["Avg ACW Time"]),
        avgTalkTimeSec: parseDurationToSeconds(row["Avg Talk Time"]),
        refusals: parseIntOrNull(row["Refusals"]),
        heldPartyAbandons: parseIntOrNull(row["Held Party Abandons"]),
        transferToAgent: parseIntOrNull(row["Transfer to Agent"])
      };
    })
    .filter(Boolean);
}
// =============================================================================
// V2: Simplified OM Staffing Report support (People/Workload/Problems design)
// =============================================================================
// Built after fully retiring the skill/unavailable-code-based design above
// (CALL_TIME_SKILL_IDS, getRecordsFromStoredRows's skillId/unavailableCode
// fields) - that design depended on multiple NICE metrics confirmed
// unreliable this session (Occupancy, Productivity Rate, General Unavailable
// Time, Available Time - all flat/blank/duplicate) and could not answer the
// real question asked ("how much time in Enphase Care"). This version
// returns to ONE ROW PER AGENT PER DAY (no Skill ID, no Unavailable Code),
// using only the 11 metrics confirmed reliable via direct verification
// against a real export: Login Time, Working Rate, ACD Contacts, Answered,
// Handle Time, Talk Time, Avg Talk Time, Refusals, Held Party Abandons,
// Transfer to Agent, Avg ACW Time.

/**
 * Parses the simplified v2 OM Staffing Report CSV (one row per agent per day)
 * into typed records. Columns are looked up BY HEADER NAME (not fixed
 * position), so field order in the export doesn't matter - only that the
 * expected header labels are present somewhere in the header row. Column
 * count is still detected dynamically from the header row's real length.
 */
export function parseOMStaffingV2Csv(csvText) {
  const lines = String(csvText ?? "")
    .split(/\r\n|\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headerFields = splitCsvLine(lines[0]);
  let lastMeaningfulColumn = -1;
  headerFields.forEach((value, index) => {
    if (String(value ?? "").trim() !== "") lastMeaningfulColumn = index;
  });
  const columnCount = lastMeaningfulColumn + 1;
  const headers = headerFields.slice(0, columnCount).map((h) => String(h ?? "").trim());

  const colIndex = (label) => headers.indexOf(label);
  const V2_COL = {
    DATE: colIndex("Date"),
    AGENT_NAME: colIndex("Agent Name"),
    AGENT_ID: colIndex("Agent ID"),
    TEAM_NAME: colIndex("Team Name"),
    LOGIN_TIME: colIndex("Login Time"),
    ACD_CONTACTS: colIndex("ACD Contacts"),
    ANSWERED: colIndex("Answered"),
    HANDLE_TIME: colIndex("Handle Time"),
    TALK_TIME: colIndex("Talk Time"),
    ACW_TIME: colIndex("ACW Time"),
    AVG_ACW_TIME: colIndex("Avg ACW Time"),
    REFUSALS: colIndex("Refusals"),
    HELD_PARTY_ABANDONS: colIndex("Held Party Abandons"),
    WORKING_RATE: colIndex("Working Rate"),
    AVG_TALK_TIME: colIndex("Avg Talk Time"),
    TRANSFER_TO_AGENT: colIndex("Transfer to Agent")
  };

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]).slice(0, columnCount);
    const rawDate = fields[V2_COL.DATE];

    if (!rawDate || rawDate.trim().toLowerCase() === "grand total") continue;

    const date = normalizeDate(rawDate);
    const agentName = String(fields[V2_COL.AGENT_NAME] ?? "").trim();
    const agentId = String(fields[V2_COL.AGENT_ID] ?? "").trim();

    if (!date || !agentName || !agentId) continue;

    records.push({
      date,
      agentName,
      agentId,
      teamName: String(fields[V2_COL.TEAM_NAME] ?? "").trim(),
      loginTimeSec: parseDurationToSeconds(fields[V2_COL.LOGIN_TIME]),
      acdContacts: parseIntOrNull(fields[V2_COL.ACD_CONTACTS]),
      answered: parseIntOrNull(fields[V2_COL.ANSWERED]),
      handleTimeSec: parseDurationToSeconds(fields[V2_COL.HANDLE_TIME]),
      talkTimeSec: parseDurationToSeconds(fields[V2_COL.TALK_TIME]),
      acwTimeSec: parseDurationToSeconds(fields[V2_COL.ACW_TIME]),
      avgAcwTimeSec: parseDurationToSeconds(fields[V2_COL.AVG_ACW_TIME]),
      avgTalkTimeSec: parseDurationToSeconds(fields[V2_COL.AVG_TALK_TIME]),
      refusals: parseIntOrNull(fields[V2_COL.REFUSALS]),
      heldPartyAbandons: parseIntOrNull(fields[V2_COL.HELD_PARTY_ABANDONS]),
      transferToAgent: parseIntOrNull(fields[V2_COL.TRANSFER_TO_AGENT]),
      workingRatePct: parsePercent(fields[V2_COL.WORKING_RATE])
    });
  }

  return records;
}

/**
 * Converts already-stored v2 rows (as saved via ImportAsTableDialog.jsx, keyed
 * by column label) back into the same typed record shape as
 * parseOMStaffingV2Csv() produces - for reading back data already imported.
 */
export function getRecordsFromStoredRowsV2(storedRows) {
  return (storedRows || [])
    .map((row) => {
      const date = normalizeDate(row["Date"]);
      const agentName = String(row["Agent Name"] ?? "").trim();
      const agentId = String(row["Agent ID"] ?? "").trim();
      if (!date || !agentName || !agentId) return null;

      return {
        date,
        agentName,
        agentId,
        teamName: String(row["Team Name"] ?? "").trim(),
        loginTimeSec: parseDurationToSeconds(row["Login Time"]),
        acdContacts: parseIntOrNull(row["ACD Contacts"]),
        answered: parseIntOrNull(row["Answered"]),
        handleTimeSec: parseDurationToSeconds(row["Handle Time"]),
        talkTimeSec: parseDurationToSeconds(row["Talk Time"]),
        acwTimeSec: parseDurationToSeconds(row["ACW Time"]),
        avgAcwTimeSec: parseDurationToSeconds(row["Avg ACW Time"]),
        avgTalkTimeSec: parseDurationToSeconds(row["Avg Talk Time"]),
        refusals: parseIntOrNull(row["Refusals"]),
        heldPartyAbandons: parseIntOrNull(row["Held Party Abandons"]),
        transferToAgent: parseIntOrNull(row["Transfer to Agent"]),
        workingRatePct: parsePercent(row["Working Rate"])
      };
    })
    .filter(Boolean);
}

/**
 * Computes team-wide totals across records already filtered to the active
 * Reporting Period - powers the 9 People/Workload/Problems tiles. Avg Talk
 * Time / Avg ACW Time are computed as TEAM-WIDE simple averages (total time /
 * total contacts) rather than averaging each agent's own Avg column, to avoid
 * over-weighting low-volume agents - verified against real 2026-07-01 data
 * (7 agents) before this function was written.
 */
export function computeStaffingTeamTotalsV2(records) {
  if (!records.length) return null;

  const sumField = (field) => records.reduce((total, r) => total + (r[field] ?? 0), 0);
  const distinctAgentIds = new Set(records.map((r) => r.agentId));

  const totalLoginTimeSec = sumField("loginTimeSec");

  const workingRateWeightedSum = records.reduce((total, r) => {
    if (r.workingRatePct === null || r.loginTimeSec === null) return total;
    return total + r.workingRatePct * r.loginTimeSec;
  }, 0);
  const avgWorkingRatePct = totalLoginTimeSec > 0
    ? Math.round((workingRateWeightedSum / totalLoginTimeSec) * 100) / 100
    : null;

  const totalAcdContacts = sumField("acdContacts");
  const totalTalkTimeSec = sumField("talkTimeSec");
  const totalAcwTimeSec = sumField("acwTimeSec");

  const avgTalkTimeSec = totalAcdContacts > 0 ? Math.round(totalTalkTimeSec / totalAcdContacts) : null;
  const avgAcwTimeSec = totalAcdContacts > 0 ? Math.round(totalAcwTimeSec / totalAcdContacts) : null;

  return {
    teamHeadcount: distinctAgentIds.size,
    totalLoginTimeSec,
    avgWorkingRatePct,
    totalAcdContacts,
    avgTalkTimeSec,
    avgAcwTimeSec,
    totalRefusals: sumField("refusals"),
    totalHeldPartyAbandons: sumField("heldPartyAbandons"),
    totalTransferToAgent: sumField("transferToAgent")
  };
}

// ---------------------------------------------------------------------------
// Raw 2D row output (for ImportAsTableDialog.jsx's generic table-import flow)
// ---------------------------------------------------------------------------

/**
 * Parses the raw OM Report CSV into a plain 2D array of rows (header row first, followed by
 * one row per agent-day) - the exact shape ImportAsTableDialog.jsx's generic column-mapping /
 * table-storage flow expects (matching the same contract the old parseSupervisorSnapshotCsv.js
 * provided: rows[0] = header labels, rows[1..] = raw string cells). Excludes the trailing
 * "Grand Total" row, same as parseOMStaffingCsv() above, since it must never appear as a fake
 * "agent" row in the stored table either.
 *
 * Column count is detected DYNAMICALLY from the header row's actual last non-blank column,
 * rather than a hardcoded count - this report's schema has changed 3 times already in one
 * session (columns inserted for Skill ID, then Unavailable Code), each time silently breaking
 * a hardcoded truncation count. Detecting it fresh from the real header row means any FUTURE
 * column NICE adds is handled automatically without needing another manual fix here.
 *
 * Use THIS function (not parseOMStaffingCsv) when wiring up the "Import Staffing" file-choose
 * flow in ImportAsTableDialog.jsx. Use parseOMStaffingCsv/computeTeamDailyTotals separately when
 * computing Team Counts or per-agent aggregates FROM already-stored staffing snapshot rows.
 */
export function parseOMStaffingRawRows(csvText) {
  const lines = String(csvText ?? "")
    .split(/\r\n|\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headerFields = splitCsvLine(lines[0]);
  let lastMeaningfulColumn = -1;
  headerFields.forEach((value, index) => {
    if (String(value ?? "").trim() !== "") lastMeaningfulColumn = index;
  });
  const columnCount = lastMeaningfulColumn + 1;

  const rows = [];
  for (const line of lines) {
    const fields = splitCsvLine(line);
    const dateValue = fields[0];
    if (dateValue && dateValue.trim().toLowerCase() === "grand total") continue;
    rows.push(fields.slice(0, columnCount));
  }
  return rows;
}

/**
 * The 7 confirmed skill IDs representing actual O&M call-handling queues (voice/manual outbound
 * work), as opposed to the many other Skill IDs present in the raw export that represent
 * non-call or unrelated activity. Used to compute "Call Time" - total time associated with real
 * call-handling work, regardless of which specific state (available, ACW, Dialer Wrap Up,
 * Enphase Care, etc.) that time fell into within those skills.
 *   23107507 - NA-US-ENG-EnphaseCare VM
 *   18494355 - NA-US-ENG-O_M Pronto Tier1
 *   18600609 - NA-US-ENG-O_M Pronto VM
 *   35610502 - NA-US-ENG-Propel
 *   23107506 - NA-US-ENG-Sales-EnphaseCare
 *   4181271  - NA-US-Manual Outbound
 *   16431139 - NA-US-Pronto Manual OB
 */
export const CALL_TIME_SKILL_IDS = new Set([
  "23107507", "18494355", "18600609", "35610502", "23107506", "4181271", "16431139"
]);
