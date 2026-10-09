type TrackerCell = string | number | boolean;
interface TrackerSnapshot {
  version: number;
  sourceId: string;
  capturedAt: string;
  headers: string[];
  formats: string[];
  rows: TrackerCell[][];
}

const SOURCE_ID = "14EF52C5-B692-4E6D-A562-9193E6BD2F1E";
const MARKER = "EnQuote Virginia Source ID";

function validateSnapshot(snapshotJson: string): TrackerSnapshot {
  if (snapshotJson.length > 500000) throw new Error("Snapshot is too large.");
  const snapshot = JSON.parse(snapshotJson) as TrackerSnapshot;
  if (!snapshot || snapshot.version !== 1 || snapshot.sourceId !== SOURCE_ID ||
      !Array.isArray(snapshot.headers) || !Array.isArray(snapshot.formats) || !Array.isArray(snapshot.rows) ||
      snapshot.rows.length > 5000 || snapshot.formats.length !== snapshot.headers.length ||
      snapshot.headers.some((header) => typeof header !== "string" || !header.trim()) ||
      snapshot.formats.some((format) => typeof format !== "string") ||
      !snapshot.headers.includes("ID") || snapshot.headers.includes(MARKER) ||
      new Set(snapshot.headers).size !== snapshot.headers.length) {
    throw new Error("Invalid snapshot. The target workbook was not changed.");
  }
  const age = Date.now() - Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 600000) throw new Error("Snapshot is expired. Read Virginia's tracker again.");
  const idIndex = snapshot.headers.indexOf("ID");
  const ids = new Set<string>();
  for (const row of snapshot.rows) {
    if (!Array.isArray(row) || row.length !== snapshot.headers.length ||
        row.some((cell) => !["string", "number", "boolean"].includes(typeof cell) ||
          (typeof cell === "number" && !Number.isFinite(cell)))) {
      throw new Error("Invalid source row. The target workbook was not changed.");
    }
    const id = String(row[idIndex]).trim();
    if (!id || ids.has(id)) throw new Error("Missing or duplicate source ID. The target workbook was not changed.");
    ids.add(id);
  }
  return snapshot;
}

function literalCell(value: TrackerCell): TrackerCell {
  return typeof value === "string" && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function main(workbook: ExcelScript.Workbook, snapshotJson: string): string {
  const snapshot = validateSnapshot(snapshotJson);
  const table = workbook.getTable("Table2");
  if (!table) throw new Error("The shared tracker must contain Table2.");
  const headers = table.getHeaderRowRange().getTexts()[0];
  const sourceIndex = snapshot.headers.indexOf("ID");
  const targetIndex = headers.indexOf("ID");
  if (targetIndex < 0 || new Set(headers).size !== headers.length) throw new Error("Invalid target headers.");
  const existing = table.getRowCount() ? table.getRangeBetweenHeaderAndTotal().getValues() : [];
  const targetIds = new Map<string, number>();
  for (let index = 0; index < existing.length; index++) {
    const row = existing[index];
    const id = String(row[targetIndex]).trim();
    if (!id && row.every((cell) => String(cell).trim() === "")) continue;
    if (!id || targetIds.has(id)) throw new Error("Target has populated rows with missing or duplicate IDs. Correct them before running the flow.");
    targetIds.set(id, index);
  }
  const sourceIds = new Set(snapshot.rows.map((row) => String(row[sourceIndex]).trim()));
  const markerIndex = headers.indexOf(MARKER);
  const deleteIndexes: number[] = [];
  for (let index = 0; index < existing.length; index++) {
    if (markerIndex >= 0 && existing[index][markerIndex] === SOURCE_ID &&
        !sourceIds.has(String(existing[index][targetIndex]).trim())) deleteIndexes.push(index);
  }

  for (const header of [...snapshot.headers, MARKER]) {
    if (!headers.includes(header)) {
      table.addColumn(-1, undefined, header);
      headers.push(header);
    }
  }
  const newMarkerIndex = headers.indexOf(MARKER);
  let updated = 0;
  const additions: TrackerCell[][] = [];
  for (const sourceRow of snapshot.rows) {
    const id = String(sourceRow[sourceIndex]).trim();
    const index = targetIds.get(id);
    const targetRow: TrackerCell[] = index === undefined
      ? headers.map(() => "") : headers.map((_, column) => existing[index][column] ?? "");
    let changed = targetRow[newMarkerIndex] !== SOURCE_ID;
    for (let column = 0; column < snapshot.headers.length; column++) {
      const targetColumn = headers.indexOf(snapshot.headers[column]);
      const value = sourceRow[column];
      if (targetRow[targetColumn] !== value) changed = true;
      targetRow[targetColumn] = literalCell(value);
    }
    targetRow[newMarkerIndex] = SOURCE_ID;
    if (index === undefined) additions.push(targetRow);
    else if (changed) {
      table.getRangeBetweenHeaderAndTotal().getRow(index).setValues([targetRow]);
      updated++;
    }
  }
  for (const index of deleteIndexes.reverse()) table.deleteRowsAt(index, 1);
  if (additions.length) table.addRows(-1, additions);
  if (table.getRowCount()) {
    const body = table.getRangeBetweenHeaderAndTotal();
    const formats = body.getNumberFormat();
    const values = body.getValues();
    for (let row = 0; row < values.length; row++) {
      if (values[row][newMarkerIndex] !== SOURCE_ID) continue;
      for (let column = 0; column < snapshot.headers.length; column++) {
        formats[row][headers.indexOf(snapshot.headers[column])] = snapshot.formats[column];
      }
    }
    body.setNumberFormat(formats);
  }
  return JSON.stringify({
    ok: true, added: additions.length, updated, deleted: deleteIndexes.length,
    sourceRows: snapshot.rows.length, capturedAt: snapshot.capturedAt
  });
}
