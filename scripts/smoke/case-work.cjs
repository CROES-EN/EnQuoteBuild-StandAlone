const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runCaseWork(win) {
  win.showInactive();
  const evaluate = code => win.webContents.executeJavaScript(code);
  await evaluate(`(() => {
    const row = (field, oldValue, newValue, date, caseNumber = "000123") => ({
      "Case Number": caseNumber, "Enlighten Site ID": "00123", "Field / Event": field,
      "Old Value": oldValue, "New Value": newValue, "Edited By": "Automation", "Edit Date": date
    });
    window.__smokeWorkTables = [
      {id: "case_history", reportType: "case_history", columns: ["Case Number", "Field / Event", "Old Value", "New Value", "Edited By", "Edit Date"],
        rows: [
          row("Case Owner", "Outside", "Carsten Roeschberger", "6/30/2026 9:00 AM"),
          row("Status", "New", "Closed", "7/1/2026 9:00 AM"),
          row("Case Owner", "Carsten Roeschberger", "Outside", "7/2/2026 9:00 AM"),
          row("Subject", "", "No work credit", "7/1/2026 9:00 AM", "ignored"),
          row("Status", "New", "Closed", "7/1/2026 9:00 AM", "unknown")
        ]},
      {id: "invoice_payments", reportType: "invoice_payments", columns: ["Invoice ID", "Paid Date", "Amount Paid", "Currency"],
        rows: [{"Invoice ID": "inv-1", "Paid Date": "7/1/2026", "Amount Paid": "1250.25", Currency: "USD"}]}
    ];
    const params = new URLSearchParams({tab: "dashboard"});
    params.set("enquoteReportPeriod", JSON.stringify({
      range: {preset: "custom_range", start: "2026-07-01", end: "2026-07-02"}, mode: "period_total"
    }));
    location.hash = "#/SupervisorDashboard?" + params;
    return true;
  })()`);
  await sleep(2000);
  const tileText = id => evaluate(`document.querySelector('[data-enquote-share-target="supervisor-tile:${id}"]')?.innerText`);
  for (const [id, label, count] of [
    ["case_work_worked", "Cases Worked", "1"],
    ["case_work_closed", "Cases Closed", "1"],
    ["case_work_transfers", "Cases Transferred Out", "1"],
    ["case_work_events", "Case Work Events", "2"],
    ["case_work_unresolved", "Case Ownership Needs Review", "1"],
    ["invoice_payments_count", "Invoices Paid", "1"],
    ["invoice_payments_amount", "Amount Collected", "$1,250.25"]
  ]) {
    const text = await tileText(id);
    assert.ok(text?.toLowerCase().includes(label.toLowerCase()), `${label} renders in customizable tile registry: ${await evaluate('document.body.innerText.slice(-1800)')}`);
    assert.ok(text.split("\n").includes(count), `${label} matches strict calculation: ${text}`);
  }
  await evaluate(`document.querySelector('[data-enquote-share-target="supervisor-tile:case_work_worked"] button').click(); true`);
  await sleep(300);
  const detail = await evaluate(`document.querySelector('[role="dialog"]').innerText`);
  assert.ok(detail.includes("Automation"), "outside actor remains in confirmed team-owned closure");
  assert.ok(detail.includes("Open-to-Closed with history-supported team ownership"));
  assert.ok(detail.includes("Transfer from team to outside owner or queue"));
  assert.ok(!detail.includes("No work credit"), "subject changes never contribute");
  await evaluate(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); true`);
  await sleep(300);
  await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent === "Case-work team").click(); true`);
  await sleep(300);
  assert.equal(await evaluate('document.getElementById("case-work-team").value.split("\\n").length'), 10);
  await evaluate(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); true`);
  await sleep(300);
  await evaluate(`(() => {
    const params = new URLSearchParams({tab: "dashboard"});
    params.set("enquoteReportPeriod", JSON.stringify({
      range: {preset: "custom_range", start: "2026-10-01", end: "2026-10-07"}, mode: "period_total"
    }));
    location.hash = "#/SupervisorDashboard?" + params; return true;
  })()`);
  await sleep(600);
  assert.ok((await tileText("case_work_worked")).split("\n").includes("0"));
  assert.equal(await evaluate('document.body.innerText.includes("extends outside the imported event dates")'), true);
  await new Promise(resolve => {
    win.webContents.once("did-finish-load", resolve);
    win.webContents.reload();
  });
  await sleep(2000);
  assert.ok((await tileText("case_work_worked")).includes("Import Case Work History"), "missing history shows an import prompt, not a zero total");
  assert.ok((await tileText("invoice_payments_amount")).includes("Import Paid Invoices"), "missing payments cannot show quote totals as collected revenue");
  console.log("ok Case Work tiles: strict counts, actual payments, contributing rows, team settings, period coverage and missing sources");
}

module.exports = {runCaseWork};
