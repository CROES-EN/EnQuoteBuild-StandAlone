const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {QUESTIONS, validateAnswers} = require("../shared/refundForm.cjs");
const HEADERS = ["ID", "Completion time", "Requester Email", "Requester Name", ...QUESTIONS.map((question) => question.label), "Status"];

function parseCsv(input) {
  const rows = [];
  let row = [], value = "", quoted = false, endedQuote = false;
  for (const character of input.replace(/^\uFEFF/, "") + "\n") {
    if (quoted) {
      if (character === '"') {quoted = false; endedQuote = true;}
      else value += character;
    } else if (endedQuote && character === '"') {
      value += '"'; quoted = true; endedQuote = false;
    } else if (character === "," || character === "\n") {
      row.push(value.replace(/\r$/, ""));
      value = ""; endedQuote = false;
      if (character === "\n") {
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
      }
    } else if (character === '"' && value === "" && !endedQuote) {
      quoted = true;
    } else if (character !== "\r" || !endedQuote) {
      if (endedQuote) throw new Error("The selected CSV contains malformed quoted fields.");
      value += character;
    }
  }
  if (quoted) throw new Error("The selected CSV contains an unfinished quoted field.");
  return rows;
}

function csvCell(value) {
  let text = value == null ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error("The selected CSV exceeds the 20 MB export limit. Choose a new CSV.");
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length && (JSON.stringify(rows[0]) !== JSON.stringify(HEADERS) ||
      rows.some((row) => row.length !== HEADERS.length))) {
    throw new Error("Choose an empty CSV or one created by this EnQuote form. Existing columns will not be overwritten.");
  }
  return rows;
}

function appendRequest(file, request) {
  const lock = `${file}.enquote-lock`;
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx");
    const rows = readRows(file);
    if (rows.slice(1).some((row) => row[0] === request.externalResponseId)) return;
    const values = [request.externalResponseId, request.submittedAt, request.requestorEmail, request.requestorName,
      ...QUESTIONS.map((question) => request[question.key]), request.status];
    const content = (rows.length ? rows : [HEADERS]).map((row) => row.map((cell) =>
      `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n" +
      values.map(csvCell).join(",") + "\r\n";
    fs.writeFileSync(temporary, "\uFEFF" + content, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    throw new Error(`Could not append the refund CSV: ${error.code === "EEXIST" ? "Another export holds the file lock." : error.message} Close the CSV in Excel and retry.`);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }
}

function createRefundCsv({storageDir, dialog, getMainWindow, getEmail, client}) {
  let busy = false;
  function stateFile() {
    const email = String(getEmail() || "").trim().toLowerCase();
    if (!email) throw new Error("Sign in to EnQuote first.");
    return path.join(storageDir, `refund-csv-${crypto.createHash("sha256").update(email).digest("hex")}.json`);
  }
  function readState() {
    const file = stateFile();
    try {return JSON.parse(fs.readFileSync(file, "utf8"));}
    catch (error) {if (error.code === "ENOENT") return {}; throw error;}
  }
  function saveState(state, file = stateFile()) {
    fs.mkdirSync(storageDir, {recursive: true});
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf8");
    fs.renameSync(`${file}.tmp`, file);
  }
  function status() {
    const state = readState();
    return {ok: true, path: state.path || null, pending: Boolean(state.pending), saved: Boolean(state.pending?.request)};
  }
  async function select() {
    if (busy) throw new Error("Wait for the current submission to finish before changing the CSV.");
    busy = true;
    try {
      const file = stateFile();
      const state = readState();
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: "Choose refund request CSV destination", defaultPath: state.path || "EnQuote-refund-requests.csv",
        filters: [{name: "CSV file", extensions: ["csv"]}]
      });
      if (result.canceled) return {ok: true, canceled: true};
      if (stateFile() !== file) throw new Error("Your EnQuote account changed. Choose the CSV again.");
      if (!result.filePath || path.extname(result.filePath).toLowerCase() !== ".csv") throw new Error("Select a .csv file.");
      readRows(result.filePath);
      saveState({...state, path: result.filePath}, file);
      return status();
    } finally {busy = false;}
  }
  async function submit(payload) {
    if (busy) throw new Error("A refund submission is already in progress.");
    busy = true;
    try {
      const file = stateFile();
      const state = readState();
      if (!state.path) throw new Error("Choose a CSV destination before submitting.");
      if (payload) {
        if (state.pending) throw new Error("Retry the pending submission before creating another request.");
        const answers = validateAnswers(payload);
        if (!answers) throw new Error("Complete all required questions with valid answers.");
        readRows(state.path);
        state.pending = {payload: {...answers, submissionId: crypto.randomUUID()}};
        saveState(state, file);
      }
      if (!state.pending) throw new Error("There is no pending submission to retry.");
      if (!state.pending.request) {
        if (stateFile() !== file) throw new Error("Your EnQuote account changed. Return to the original account to retry.");
        const result = await client.post("/api/refund-requests/submit-native", state.pending.payload);
        if (!result?.ok || !result.request?.externalResponseId) throw new Error(result?.error || "The request was not saved by the sync service.");
        state.pending.request = result.request;
        saveState(state, file);
      }
      if (stateFile() !== file) throw new Error("Your EnQuote account changed. Return to the original account to retry CSV export.");
      try {
        appendRequest(state.path, state.pending.request);
      } catch (error) {
        return {ok: true, saved: true, exported: false, error: error.message, request: state.pending.request};
      }
      const request = state.pending.request;
      delete state.pending;
      saveState(state, file);
      return {ok: true, saved: true, exported: true, request};
    } finally {busy = false;}
  }
  return {status, select, submit, retry: () => submit()};
}

module.exports = {createRefundCsv, appendRequest, parseCsv, HEADERS};
