/**
 * Shared parser for the 5 EODB Dashboard "pivoted date-column" widgets - all 5 confirmed to
 * use the exact same layout: row 1 = Date header with one column per calendar day, row 2 =
 * "Skillname" header row (metric label repeated per column, e.g. "#Calls"), one row per real
 * skill, and a "Grand Total" row summing across skills for that date. Confirmed identical
 * shape across:
 *   - Total Call Volume (Handled + Abandoned)
 *   - # Abandoned Calls
 *   - Abandonment Rate
 *   - Daily Wait Time Summary
 *   - Average Talk Time(Phone)
 *
 * FIX (v2), based on a real imported file inspected directly this session: the Grand Total
 * row is NOT reliably the LAST row - a real import showed it at row index 3 out of 57 total
 * rows, with rows 4-56 being corrupted/artifact rows (the underlying xlsx sheet-picker
 * apparently pulled in leftover pivot-cache rows below the real table - same skill name
 * repeated ~27 times, each with a single stray Excel-date-serial number in one column and
 * blanks everywhere else). This version finds the Grand Total row by CONTENT (searching every
 * row for one whose first cell literally reads "Grand Total"), not by position, and ignores
 * everything else - so these artifact rows can never be mistaken for real data.
 *
 * FIX (v2) also confirmed a real trailing "Total" summary column exists in at least one real
 * export (not seen in the original 2 screenshots this parser was first built against) - this
 * is now explicitly excluded from being treated as a date column, rather than accidentally
 * parsed as one and producing a bogus 24th "date".
 */

function parseGrandTotalValue(raw, forcePercent) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  // FIX (real bug, confirmed live): Abandonment Rate is stored as a plain decimal number
  // (e.g. "0.18055555555555555"), never a string ending in "%" - so trimmed.endsWith("%")
  // was ALWAYS false for this widget, meaning isPercent was never correctly detected, and
  // computeEodbWidgetTotal() silently SUMMED every daily rate across the Reporting Period
  // instead of averaging them. This was invisible for a single-day period (sum of one value
  // equals that value), which is why it looked correct in every single-day spot-check, and
  // only surfaced once a genuine multi-day range was selected - confirmed via real numbers:
  // summing the 27 real daily rates from 8/17-9/13 produces exactly 430.7% (rounds to the
  // 431% seen live), while averaging them correctly produces ~16%. `forcePercent`, when
  // explicitly passed by the caller (see getEodbWidgetRecordsFromStoredRows/
  // parseEodbWidgetRows below), now overrides the fragile "%"-suffix guess entirely, since
  // the caller already knows definitively which of the 5 widget types this is.
  const isPercent = forcePercent !== undefined ? forcePercent : trimmed.endsWith("%");
  const numeric = Number.parseFloat(trimmed.replace("%", ""));
  if (!Number.isFinite(numeric)) return null;
  return { value: numeric, isPercent };
}

/**
 * Parses one of the 5 EODB pivoted-widget CSV/xlsx exports (already read into a plain 2D
 * array of rows) into one record per calendar day, using ONLY the Grand Total row (found by
 * content, not position) and ignoring every other row.
 *
 * @param {Array<Array<any>>} rows - raw 2D array: rows[0] = Date header row, remaining rows
 *   may include the Skillname header, per-skill rows, the Grand Total row (anywhere among
 *   them), and potentially trailing artifact rows that must be ignored.
 * @param {boolean} [isPercentWidget] - pass true for Abandonment Rate specifically (the only
 *   one of the 5 widgets that is a rate, not a count/duration) - overrides the unreliable
 *   "does the raw string end with %" guess, since this widget's real stored values are plain
 *   decimals with no % suffix at all.
 * @returns {Array<{ date: string, value: number, isPercent: boolean }>} one record per real
 *   date column, using the Grand Total row's value for that column.
 */
export function parseEodbWidgetRows(rows, isPercentWidget) {
  if (!Array.isArray(rows) || rows.length < 3) return [];

  const dateHeaderRow = rows[0];

  // Find the Grand Total row by CONTENT, not position - confirmed necessary against a real
  // import where it appeared at row 3 of 57, with corrupted rows following it.
  const grandTotalRow = rows.find(
    (row) => String(row?.[0] ?? "").trim().toLowerCase() === "grand total"
  );
  if (!grandTotalRow) return [];

  const records = [];
  // Column 0 is the label column (Date/Skillname/skill-name) - real date columns start at 1.
  for (let col = 1; col < dateHeaderRow.length; col++) {
    const rawDate = dateHeaderRow[col];
    const dateStr = String(rawDate ?? "").trim();
    if (!dateStr) continue;
    // A trailing "Total" summary column is confirmed to exist in at least one real export -
    // this is not a date and must be excluded, not parsed as a 24th/25th "day".
    if (dateStr.toLowerCase() === "total") continue;

    let isoDate = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      isoDate = dateStr.slice(0, 10);
    } else {
      const asNumber = Number.parseFloat(dateStr);
      if (Number.isFinite(asNumber) && dateStr === String(asNumber)) {
        const msPerDay = 86400000;
        const excelEpoch = Date.UTC(1899, 11, 30);
        const d = new Date(excelEpoch + asNumber * msPerDay);
        isoDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
    }
    if (!isoDate) continue;

    const parsed = parseGrandTotalValue(grandTotalRow[col], isPercentWidget);
    if (parsed === null) continue;

    records.push({ date: isoDate, value: parsed.value, isPercent: parsed.isPercent });
  }

  return records;
}

/**
 * Converts already-stored rows (as saved via ImportAsTableDialog.jsx's generic row-object
 * storage, keyed by column label) back into the same { date, value } record shape.
 *
 * @param {Array<Record<string, any>>} storedRows
 * @param {boolean} [isPercentWidget] - pass true for Abandonment Rate specifically - see
 *   parseEodbWidgetRows()'s own doc comment for why this must be explicit rather than
 *   guessed from the stored value's format.
 */
export function getEodbWidgetRecordsFromStoredRows(storedRows, isPercentWidget) {
  if (!Array.isArray(storedRows) || !storedRows.length) return [];

  const columnOrder = Object.keys(storedRows[0]);
  const rows2d = storedRows.map((rowObj) => columnOrder.map((col) => rowObj[col]));
  const reconstructed = [columnOrder, ...rows2d];
  return parseEodbWidgetRows(reconstructed, isPercentWidget);
}

/**
 * Computes the team-wide total for a set of EODB widget records already filtered to the
 * active Reporting Period. For plain counts, this SUMS the Grand Total across every date in
 * range. For percentage-based widgets (Abandonment Rate), this instead computes a simple
 * average across the days in range.
 */
export function computeEodbWidgetTotal(records) {
  if (!records || !records.length) return null;
  // FIX: check if ANY record is flagged as percent, not just the first - defense in depth,
  // so a single record that's missing/mis-flagged (e.g. a blank cell) can never silently
  // flip the whole period's calculation between sum and average.
  const isPercent = records.some((r) => r.isPercent);
  if (isPercent) {
    const sum = records.reduce((total, r) => total + r.value, 0);
    return Math.round((sum / records.length) * 100) / 100;
  }
  return records.reduce((total, r) => total + r.value, 0);
}
