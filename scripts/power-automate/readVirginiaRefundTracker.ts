type TrackerCell = string | number | boolean;
interface TrackerSnapshot {
  version: number;
  sourceId: string;
  capturedAt: string;
  headers: string[];
  formats: string[];
  rows: TrackerCell[][];
}

function main(workbook: ExcelScript.Workbook): string {
  const table = workbook.getTable("Table2");
  if (!table) throw new Error("Virginia's workbook must contain Table2.");
  const headers = table.getHeaderRowRange().getTexts()[0];
  const rows = table.getRowCount() ? table.getRangeBetweenHeaderAndTotal().getValues() : [];
  const formats = table.getRowCount()
    ? table.getRangeBetweenHeaderAndTotal().getNumberFormat()[0] : headers.map(() => "General");
  return makeSnapshot(headers, rows, formats);
}

function makeSnapshot(headers: string[], rows: TrackerCell[][], formats: string[]): string {
  if (!headers.includes("ID") || new Set(headers).size !== headers.length) {
    throw new Error("Virginia's table needs unique headers and an ID column.");
  }
  if (headers.includes("EnQuote Virginia Source ID")) throw new Error("The source contains the reserved mirror marker column.");
  if (formats.length !== headers.length) throw new Error("Invalid source column formats.");
  const idIndex = headers.indexOf("ID");
  const ids = new Set<string>();
  const populated = rows.filter((row) => row.some((cell) => String(cell).trim() !== ""));
  if (populated.length > 5000) throw new Error("Source exceeds the 5,000-row flow limit.");
  for (const row of populated) {
    const id = String(row[idIndex]).trim();
    if (row.length !== headers.length || !id || ids.has(id)) {
      throw new Error(`Missing or duplicate source ID: ${id || "(blank)"}. No target writes were requested.`);
    }
    ids.add(id);
  }
  const snapshot: TrackerSnapshot = {
    version: 1, sourceId: "14EF52C5-B692-4E6D-A562-9193E6BD2F1E",
    capturedAt: new Date().toISOString(), headers, formats, rows: populated
  };
  const json = JSON.stringify(snapshot);
  if (json.length > 500000) throw new Error("Snapshot exceeds the flow's 500,000-character safety limit.");
  return json;
}
