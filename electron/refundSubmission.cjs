const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {validateAnswers} = require("../shared/refundForm.cjs");
const {recordToWorkbookRow} = require("./refundWorkbookSync.cjs");

function createRefundSubmission({storageDir, getEmail, client, workbook}) {
  let busy = false;
  function stateFile() {
    const email = String(getEmail() || "").trim().toLowerCase();
    if (!email) throw new Error("Sign in to EnQuote first.");
    return path.join(storageDir, `refund-submission-${crypto.createHash("sha256").update(email).digest("hex")}.json`);
  }
  function readState() {
    try {return JSON.parse(fs.readFileSync(stateFile(), "utf8"));}
    catch (error) {if (error.code === "ENOENT") return {}; throw error;}
  }
  function saveState(state, file) {
    fs.mkdirSync(storageDir, {recursive: true});
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf8");
    fs.renameSync(`${file}.tmp`, file);
  }
  async function status() {
    const tracker = await workbook.status();
    const state = readState();
    return {...tracker, pending: Boolean(state.pending), saved: Boolean(state.pending?.request)};
  }
  async function select() {
    if (busy) throw new Error("Wait for your submission to finish before changing the workbook.");
    if (readState().pending) throw new Error("Retry your pending submission before changing the workbook.");
    const result = await workbook.select();
    return result.canceled ? result : status();
  }
  async function submit(payload) {
    if (busy) throw new Error("A refund submission is already in progress.");
    busy = true;
    try {
      const file = stateFile();
      const state = readState();
      const tracker = await workbook.status();
      if (!tracker.ok || !tracker.configured) throw new Error(tracker.error || "Connect the shared Excel workbook first.");
      if (file !== stateFile()) throw new Error("Your EnQuote account changed. Return to the original account to retry.");
      if (state.pending?.path && state.pending.path !== tracker.path) {
        throw new Error("Reconnect the original workbook to retry this pending submission.");
      }
      // Check processor access even when retrying an already-saved request.
      const access = await client.post("/api/refund-requests/workbook-sync", {imports: [], updates: []});
      if (!access?.ok) throw new Error(access?.error || "Refund-processing access is required.");
      if (payload) {
        if (state.pending) throw new Error("Retry your pending submission before creating another request.");
        const answers = validateAnswers(payload);
        if (!answers) throw new Error("Complete every required question with a valid answer.");
        await workbook.read();
        if (file !== stateFile()) throw new Error("Your EnQuote account changed. Return to the original account to retry.");
        state.pending = {path: tracker.path, payload: {...answers, submissionId: crypto.randomUUID()}};
        saveState(state, file);
      }
      if (!state.pending) throw new Error("No pending request needs retry.");
      if (file !== stateFile()) throw new Error("Your EnQuote account changed. Return to the original account to retry.");
      if (!state.pending.request) {
        const result = await client.post("/api/refund-requests/submit-native", state.pending.payload);
        if (!result?.ok || !result.request?.externalResponseId) throw new Error(result?.error || "The sync service did not save the request.");
        state.pending.request = result.request;
        saveState(state, file);
      } else {
        const result = await client.get("/api/refund-requests");
        const latest = result.requests?.find((request) => request.externalResponseId === state.pending.request.externalResponseId);
        if (!result.ok || !latest) throw new Error(result.error || "Could not find the saved request. Retry when the sync service is available.");
        state.pending.request = latest;
        saveState(state, file);
      }
      if (file !== stateFile()) throw new Error("Your EnQuote account changed. Return to the original account to retry.");
      if (tracker.path !== (await workbook.status()).path) throw new Error("The connected workbook changed. Retry to confirm the destination.");
      try {
        await workbook.write([recordToWorkbookRow(state.pending.request)], tracker.path);
      } catch (error) {
        return {ok: true, saved: true, written: false, error: error.message, request: state.pending.request};
      }
      const request = state.pending.request;
      delete state.pending;
      saveState(state, file);
      return {ok: true, saved: true, written: true, request};
    } finally {busy = false;}
  }
  return {status, select, submit, retry: () => submit()};
}

module.exports = {createRefundSubmission};
