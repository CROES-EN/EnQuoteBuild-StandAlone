import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {transform} from "esbuild";
import ts from "typescript";

const excelTypes = `
declare namespace ExcelScript {
  interface Workbook { getTable(name: string): Table | undefined; }
  interface Table {
    getHeaderRowRange(): Range;
    getRangeBetweenHeaderAndTotal(): Range;
    getRowCount(): number;
    addColumn(index?: number, values?: (string | number | boolean)[], name?: string): TableColumn;
    addRows(index?: number, values?: (string | number | boolean)[][]): void;
    deleteRowsAt(index: number, count?: number): void;
  }
  interface TableColumn {}
  interface Range {
    getTexts(): string[][];
    getValues(): (string | number | boolean)[][];
    getNumberFormat(): string[][];
    setNumberFormat(formats: string[][]): void;
    getRow(index: number): Range;
    setValues(values: (string | number | boolean)[][]): void;
  }
}`;

async function loadScript(name, symbols) {
  const file = path.resolve("scripts", "power-automate", name);
  const source = fs.readFileSync(file, "utf8");
  const result = await transform(`${source}\nmodule.exports = {${symbols.join(",")}};`, {
    loader: "ts", format: "cjs", target: "es2020"
  });
  const module = {exports: {}};
  new Function("module", result.code)(module);
  return module.exports;
}

const reader = await loadScript("readVirginiaRefundTracker.ts", ["main", "makeSnapshot"]);
const writer = await loadScript("mirrorVirginiaRefundTracker.ts", ["main", "validateSnapshot"]);
const marker = "EnQuote Virginia Source ID";
const sourceId = "14EF52C5-B692-4E6D-A562-9193E6BD2F1E";

test("both standalone Office Scripts typecheck against their Excel API surface", () => {
  for (const name of ["readVirginiaRefundTracker.ts", "mirrorVirginiaRefundTracker.ts"]) {
    const file = path.resolve("scripts", "power-automate", name);
    const source = fs.readFileSync(file, "utf8") + excelTypes;
    const options = {noEmit: true, strict: true, target: ts.ScriptTarget.ES2020, types: [], skipLibCheck: true};
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) =>
      path.resolve(filename) === file ? ts.createSourceFile(file, source, languageVersion, true) :
        getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([file], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.deepEqual(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  }
});

function workbook(headers = ["ID", "Customer name", "Status"], rows = []) {
  const state = {
    headers: [...headers], rows: rows.map((row) => [...row]),
    formats: rows.map(() => headers.map(() => "General")), writes: 0
  };
  const body = {
    getValues: () => state.rows.map((row) => [...row]),
    getNumberFormat: () => state.formats.map((row) => [...row]),
    setNumberFormat: (formats) => {state.formats = formats; state.writes++;},
    getRow: (index) => ({setValues: ([row]) => {state.rows[index] = row; state.writes++;}})
  };
  const table = {
    getRowCount: () => state.rows.length,
    getHeaderRowRange: () => ({getTexts: () => [[...state.headers]]}),
    getRangeBetweenHeaderAndTotal: () => body,
    addColumn: (_index, _values, name) => {
      state.headers.push(name);
      state.rows.forEach((row) => row.push(""));
      state.formats.forEach((row) => row.push("General"));
      state.writes++;
    },
    addRows: (_index, additions) => {
      state.rows.push(...additions);
      state.formats.push(...additions.map(() => state.headers.map(() => "General")));
      state.writes++;
    },
    deleteRowsAt: (index, count) => {
      state.rows.splice(index, count);
      state.formats.splice(index, count);
      state.writes++;
    }
  };
  return {state, getTable: (name) => name === "Table2" ? table : undefined};
}

function snapshot(rows, headers = ["ID", "Customer name", "Status"], formats = headers.map(() => "General")) {
  return reader.makeSnapshot(headers, rows, formats);
}

test("source script reads a complete table without modifying it and rejects invalid IDs", () => {
  const source = workbook(undefined, [[6, "New customer", "Submitted"], ["", "", ""]]);
  const result = JSON.parse(reader.main(source));
  assert.equal(result.rows.length, 1);
  assert.equal(source.state.writes, 0);
  assert.throws(() => snapshot([[1, "First", ""], ["1", "Duplicate", ""]]), /duplicate/);
  assert.throws(() => snapshot([["", "Missing ID", ""]]), /Missing/);
  assert.throws(() => reader.main({getTable: () => undefined}), /Table2/);
});

test("mirror upserts numeric/text IDs, clears source values and preserves target-only fields", () => {
  const target = workbook(["ID", "Customer name", "Status", "EnQuote Store Team Notes"], [
    ["6", "Old name", "Approved", "Local note"],
    ["native-only", "Native request", "Submitted", "Keep"]
  ]);
  const data = snapshot([[6, "Real form response", ""], [7, "Next response", "Submitted"]]);
  const result = JSON.parse(writer.main(target, data));
  assert.equal(result.updated, 1);
  assert.equal(result.added, 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(target.state.rows[0].slice(0, 4), [6, "Real form response", "", "Local note"]);
  assert.equal(target.state.rows[0].at(-1), sourceId);
  assert.equal(target.state.rows[1][0], "native-only");
  const repeat = JSON.parse(writer.main(target, data));
  assert.equal(repeat.added, 0);
  assert.equal(repeat.updated, 0);
  assert.equal(target.state.rows.length, 3);
});

test("initial empty source preserves unmarked rows; later deletion removes only flow-owned rows", () => {
  const target = workbook(undefined, [[1, "Existing", ""], ["native-only", "Keep", ""]]);
  writer.main(target, snapshot([]));
  assert.equal(target.state.rows.length, 2);
  writer.main(target, snapshot([[1, "Existing", ""], [2, "Next", ""]]));
  const result = JSON.parse(writer.main(target, snapshot([[2, "Next", ""]])));
  assert.equal(result.deleted, 1);
  assert.deepEqual(target.state.rows.map((row) => row[0]), ["native-only", 2]);
  const empty = JSON.parse(writer.main(target, snapshot([])));
  assert.equal(empty.deleted, 1);
  assert.equal(target.state.rows[0][0], "native-only");
});

test("bad snapshot, stale snapshot and duplicate target IDs fail before any target writes", () => {
  const target = workbook(undefined, [[1, "One", ""]]);
  const original = snapshot([[1, "Changed", ""]]);
  const invalid = JSON.parse(original);
  invalid.sourceId = "wrong-source";
  assert.throws(() => writer.main(target, JSON.stringify(invalid)), /Invalid snapshot/);
  invalid.sourceId = sourceId;
  invalid.capturedAt = "2000-01-01T00:00:00Z";
  assert.throws(() => writer.main(target, JSON.stringify(invalid)), /expired/);
  invalid.capturedAt = new Date().toISOString();
  invalid.rows.push(invalid.rows[0]);
  assert.throws(() => writer.main(target, JSON.stringify(invalid)), /duplicate/);
  assert.equal(target.state.writes, 0);
  const duplicate = workbook(undefined, [[1, "One", ""], ["1", "Same", ""]]);
  assert.throws(() => writer.main(duplicate, original), /duplicate IDs/);
  assert.equal(duplicate.state.writes, 0);
});

test("dates retain Excel serials and formatting, while formula-like answers stay literal", () => {
  const target = workbook();
  const data = snapshot([[1, 46304.5, "=HYPERLINK(\"example\")"]], ["ID", "Completion time", "Customer name"],
    ["General", "yyyy-mm-dd hh:mm", "@"]);
  writer.main(target, data);
  const column = target.state.headers.indexOf("Completion time");
  assert.equal(target.state.rows[0][column], 46304.5);
  assert.equal(target.state.formats[0][column], "yyyy-mm-dd hh:mm");
  assert.equal(target.state.rows[0][target.state.headers.indexOf("Customer name")], "'=HYPERLINK(\"example\")");
});

test("a partial failed run converges on retry instead of duplicating requests", () => {
  const target = workbook();
  const data = snapshot([[1, "First", ""], [2, "Second", ""]]);
  const table = target.getTable("Table2");
  const addRows = table.addRows;
  table.addRows = (_index, additions) => {
    addRows(-1, additions.slice(0, 1));
    throw new Error("Excel connector interrupted");
  };
  assert.throws(() => writer.main(target, data), /interrupted/);
  table.addRows = addRows;
  const result = JSON.parse(writer.main(target, data));
  assert.equal(result.added, 1);
  assert.deepEqual(target.state.rows.map((row) => row[0]), [1, 2]);
  assert.equal(target.state.headers.filter((header) => header === marker).length, 1);
});
