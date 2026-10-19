const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runViewState(win) {
  win.showInactive();
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function waitFor(code, label) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function navigate(page, selector) {
    await evaluate(`location.hash = ${JSON.stringify(`#/${page}`)}; true`);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, page);
  }
  async function input(selector, value) {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event("input", {bubbles: true}));
    })(); true`);
    await sleep(100);
  }
  const quoteSearch = 'input[placeholder^="Search by Site ID"]';
  const workloadSearch = 'input[placeholder="Search cases..."]';
  await evaluate(`localStorage.setItem("enquote_local_session_email", "smoke.test@enphaseenergy.com");
    window.dispatchEvent(new CustomEvent("enquote_user_session_changed")); true`);
  await navigate("Quotes", quoteSearch);
  await input(quoteSearch, "001234");
  await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent.includes("Golden Quotes")).click(); true`);
  await navigate("Tasks", '[role="tab"][data-state="active"]');
  await navigate("Quotes", quoteSearch);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(quoteSearch)}).value`), "001234");
  assert.equal(await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent.includes("Golden Quotes")).getAttribute("aria-pressed")`), "true");
  await navigate("Quotes?status=submitted", quoteSearch);
  await waitFor(`JSON.parse(localStorage.getItem("enquote_view_v1:quotes:status::smoke.test@enphaseenergy.com")) === "submitted"`, "explicit status link overrides saved status");
  await navigate("SLAReporting", '[role="tab"][data-state="active"]');
  await evaluate(`document.querySelector('[role="tab"][data-state="inactive"]').click(); true`);
  const slaTab = await evaluate(`document.querySelector('[role="tab"][data-state="active"]').textContent`);
  await navigate("Quotes", quoteSearch);
  await navigate("SLAReporting", '[role="tab"][data-state="active"]');
  assert.equal(await evaluate(`document.querySelector('[role="tab"][data-state="active"]').textContent`), slaTab);

  await evaluate(`(() => {
    const columns = ["O&M Status", "Project Picklist", "Status", "Case Number", "Enlighten Site ID",
      "Case Last Modified By", "Subject", "Case Owner", "Contact Name", "Contact: Email",
      "New_Location", "Contact: Phone", "Date/Time Opened"];
    const first = Object.fromEntries(columns.map(column => [column, "Keep"]));
    const second = Object.fromEntries(columns.map(column => [column, "Exclude"]));
    first["Case Number"] = "001234"; second["Case Number"] = "009999";
    first["Date/Time Opened"] = "10/1/2026"; second["Date/Time Opened"] = "10/2/2026";
    window.__smokeWorkTables = [{id:"workload", reportType:"workload", columns, rows:[first, second]}];
    localStorage.setItem("enquote_view_v1:workload:all-cases::smoke.test@enphaseenergy.com", "true");
    localStorage.setItem("enquote_workload_column_hidden_v1::smoke.test@enphaseenergy.com", "[]");
  })(); true`);
  await navigate("Workload", workloadSearch);
  await waitFor(`document.querySelectorAll("th[data-flip-col]").length >= 13`, "Workload columns");
  const columnNames = await evaluate(`[...document.querySelectorAll("th[data-flip-col]")].map(element => element.dataset.flipCol)`);
  for (const column of columnNames) {
    await evaluate(`document.querySelector('th[data-flip-col=' + CSS.escape(${JSON.stringify(column)}) + '] button[title]').click(); true`);
    await waitFor(`Boolean(document.querySelector('input[placeholder="Search values..."]'))`, `filter ${column}`);
    await evaluate(`(() => {
      const popover = document.querySelector('input[placeholder="Search values..."]').parentElement.parentElement;
      const label = [...popover.querySelectorAll("label")].find(item =>
        ["Exclude", "009999", "10/2/2026"].includes(item.textContent.trim()));
      if (!label) throw new Error("Missing excluded filter value");
      label.querySelector("input").click();
    })(); true`);
    await sleep(60);
    await evaluate(`(() => {
      const popover = document.querySelector('input[placeholder="Search values..."]').parentElement.parentElement;
      [...popover.querySelectorAll("button")].find(button => button.textContent.trim() === "OK").click();
    })(); true`);
    await sleep(60);
  }
  const before = await evaluate(`localStorage.getItem("enquote_view_v1:workload:columns::smoke.test@enphaseenergy.com")`);
  assert.equal(Object.keys(JSON.parse(before)).length, columnNames.length);
  await input(workloadSearch, "Keep");
  await navigate("Tasks", '[role="tab"][data-state="active"]');
  await navigate("Workload", workloadSearch);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(workloadSearch)}).value`), "Keep");
  assert.equal(await evaluate(`document.querySelectorAll('th button[title^="Filtered"]').length`), columnNames.length);
  assert.equal(await evaluate(`localStorage.getItem("enquote_view_v1:workload:columns::smoke.test@enphaseenergy.com")`), before);
  assert.equal(await evaluate(`document.body.innerText.includes("1 of 2 cases")`), true, "restored filters produce the same narrowed result");
  await evaluate(`[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Reload").click(); true`);
  await sleep(250);
  assert.equal(await evaluate(`document.querySelectorAll('th button[title^="Filtered"]').length`), columnNames.length, "report reload retains filters");
  const sharedTarget = {kind: "record", value: "workload-case:009999"};
  await navigate(`Workload?enquoteShareTarget=${encodeURIComponent(JSON.stringify(sharedTarget))}`, workloadSearch);
  await waitFor(`document.querySelectorAll('th button[title^="Filtered"]').length === 0`, "shared case bypasses personal filters");
  // Shared-case links must not permanently replace the user's ordinary filtered view.
  await navigate("Tasks", '[role="tab"][data-state="active"]');
  await navigate("Workload", workloadSearch);
  assert.equal(await evaluate(`document.querySelectorAll('th button[title^="Filtered"]').length`), columnNames.length);
  await evaluate(`localStorage.setItem("enquote_local_session_email", "other-view-test@example.com");
    window.dispatchEvent(new CustomEvent("enquote_user_session_changed")); true`);
  await waitFor(`document.querySelector(${JSON.stringify(workloadSearch)}).value === ""`, "user switch clears search");
  assert.equal(await evaluate(`document.querySelectorAll('th button[title^="Filtered"]').length`), 0);
  await evaluate(`localStorage.setItem("enquote_local_session_email", "smoke.test@enphaseenergy.com");
    window.dispatchEvent(new CustomEvent("enquote_user_session_changed")); true`);
  await waitFor(`document.querySelectorAll('th button[title^="Filtered"]').length === ${columnNames.length}`, "original user filters restored");
  await navigate("Quotes", quoteSearch);
  await new Promise(resolve => {
    win.webContents.once("did-finish-load", resolve);
    win.webContents.reload();
  });
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(quoteSearch)}))`, "Quotes after UI reload");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(quoteSearch)}).value`), "001234");
  console.log(`ok   Views: Quotes search/Golden filter, explicit status links, SLA tab, ${columnNames.length} Workload column filters, navigation and user isolation`);
}

module.exports = {runViewState};
