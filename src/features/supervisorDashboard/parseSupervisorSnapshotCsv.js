/**
 * Parses a NICE CXONE "Supervisor Snapshot" export - a CSV bundling SEVERAL different sections
 * into one file, each marked by a literal type-label in its first field ("Team Time",
 * "Team Count", "Team Duration", "Agent", "Agent Name") - there is NO single header row for the
 * whole file, and no date column anywhere in it (the caller must supply which date this
 * snapshot represents - see saveStaffingSnapshot() in importedTableStore.js).
 *
 * This parser extracts ONLY the "Agent" section - one row per agent, confirmed exactly against
 * a real export. Each "Agent" line repeats its own column labels literally as its first 10
 * fields, followed by the real 10 data values for that agent, e.g.:
 *   Agent,Inbound Handled,Inbound AHT,Outbound Handled,Outbound AHT,Available Time,
 *   Unavailable Time,Refused,Login Time,Occupancy,"Ankenman, Denice",1,00:14:48,,00:00:00,
 *   00:00:00,06:07:40,0,06:22:18,100%
 * Every OTHER section (Team Time/Team Count/Team Duration summary rows, and "Agent Name" login-
 * session rows) is deliberately ignored - they have no per-agent, per-day shape that maps onto a
 * single Staffing row, and Team Headcount/Available Staff only ever need the "Agent" section's
 * one-row-per-agent daily summary.
 */

const AGENT_ROW_MARKER = "Agent";
const AGENT_HEADER_FIELD_COUNT = 10;

// The real column labels, in order, for the 10 DATA fields that follow each "Agent" row's own
// repeated 10-field header - "Agent Name" replaces the literal "Agent" section marker, since
// that position actually holds the real agent's name once the header fields are skipped.
const AGENT_DATA_COLUMNS = [
  "Agent Name",
  "Inbound Handled",
  "Inbound AHT",
  "Outbound Handled",
  "Outbound AHT",
  "Available Time",
  "Unavailable Time",
  "Refused",
  "Login Time",
  "Occupancy"
];

/** Splits ONE CSV line into fields, respecting double-quoted fields that may contain commas
 *  (e.g. "Ankenman, Denice") - a plain String.split(",") would incorrectly break those apart. */
function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * @param {string} text - the raw Supervisor Snapshot CSV file contents
 * @returns {string[][]} - rows[][] shape (header row at index 0, one data row per agent after
 *   it) matching the same convention every other parser in this app already returns (see
 *   readHtmlSectionRows in reportParsing.js), so it flows into ImportAsTableDialog.jsx's
 *   existing pipeline unchanged.
 */
export function parseSupervisorSnapshotCsv(text) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  const dataRows = [];

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const fields = splitCsvLine(line);
    if (fields[0] !== AGENT_ROW_MARKER) continue;
    if (fields.length < AGENT_HEADER_FIELD_COUNT * 2) continue; // malformed/truncated - skip defensively
    dataRows.push(fields.slice(AGENT_HEADER_FIELD_COUNT, AGENT_HEADER_FIELD_COUNT * 2));
  }

  return [AGENT_DATA_COLUMNS, ...dataRows];
}

/**
 * Convenience helper: given one day's already-parsed agent data rows (NOT including the
 * header), returns Team Headcount (distinct agent count) and Available Staff (agents with a
 * real, nonzero Login Time). Login Time is an "HH:MM:SS" clock string here, so "worked at all"
 * is detected as "not exactly 00:00:00" rather than parsed into a duration.
 *
 * @param {string[][]} dataRows - agent data rows only (index 8 = Login Time, matching
 *   AGENT_DATA_COLUMNS above)
 */
export function computeStaffingCounts(dataRows) {
  const teamHeadcount = dataRows.length;
  const availableStaff = dataRows.filter((row) => {
    const loginTime = String(row[8] ?? "").trim();
    return loginTime !== "" && loginTime !== "00:00:00";
  }).length;
  return { teamHeadcount, availableStaff };
}