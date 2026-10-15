const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The app reads the backlog for the current Mountain Time day, so fixture dates follow the clock.
const denverDate = (daysAgo = 0) => new Intl.DateTimeFormat("en-CA", {timeZone: "America/Denver"})
  .format(new Date(Date.now() - daysAgo * 86400000));
const BACKLOG_TODAY = denverDate(0);
const BACKLOG_PAST = denverDate(1);
const BACKLOG_MISSING = denverDate(2);

async function runBacklogRma(win) {
  win.showInactive();
  // Chart labels appear after animation, which a throttled background window may never finish.
  win.webContents.setBackgroundThrottling(false);
  const evaluate = async code => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      console.error("Backlog/RMA evaluation failed:", code);
      throw error;
    }
  };
  await evaluate(`Object.defineProperty(navigator, "clipboard", {configurable:true, value:{writeText:async text => {
    if (window.__smokeRmaClipboardFail) throw new Error("RMA clipboard unavailable");
    window.__smokeRmaClipboard = text;
  }}}); true`);
  if (process.env.ENQUOTE_PERF_PROBE) return runAutoDrafterPerfProbe(win, evaluate);
  const click = async text => {
    const found = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.dispatchEvent(new MouseEvent("mousedown", {bubbles:true, button:0}));
      button.click(); return true;
    })()`);
    assert.ok(found, `Button exists: ${text}`);
    await sleep(300);
  };
  await evaluate(`(() => {
    const snapshot = (date, count) => ({
      date, timeZone: "America/Denver", capturedAt: date + "T23:00:00Z", count,
      statusCounts: {approved: 20, invoiced: count - 20},
      rows: Array.from({length: count}, (_, i) => ({
        quote: {id: "backlog-" + i, site_id: "site-" + i, status: i < 20 ? "approved" : "invoiced"},
        alert: {name: "SLA exceeded", level: "red", overdueHours: i === 0 ? 9 : i === 1 ? 100 : 20, hoursInStatus: 120}
      }))
    });
    window.__smokeBacklog = {
      "${BACKLOG_PAST}": {ok: true, live: false, snapshot: snapshot("${BACKLOG_PAST}", 40)},
      "${BACKLOG_TODAY}": {ok: true, live: true, snapshot: snapshot("${BACKLOG_TODAY}", 39)}
    };
    const params = new URLSearchParams({tab: "dashboard"});
    params.set("enquoteReportPeriod", JSON.stringify({
      range: {preset: "custom_range", start: "${BACKLOG_PAST}", end: "${BACKLOG_PAST}"}, mode: "period_total"
    }));
    location.hash = "#/SupervisorDashboard?" + params;
    return true;
  })()`);
  await sleep(2200);
  const tile = () => evaluate(`document.querySelector('[data-enquote-share-target="supervisor-tile:quote_backlog"]')?.innerText`);
  let text = await tile();
  assert.ok(text?.split("\n").includes("40"), `Historical backlog shows 40: ${text}`);
  assert.match(text, /Frozen daily snapshot/);
  assert.ok(text.split("\n").filter(value => value === "20").length === 2, "Both status counts shown");
  await evaluate(`document.querySelector('[data-enquote-share-target="supervisor-tile:quote_backlog"] button').click(); true`);
  await sleep(300);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] tbody tr td')?.innerText`), "site-1", "100 overdue hours sorts before 20 and 9");
  await evaluate(`document.querySelector('[aria-label="Backlog status"]').click(); true`);
  await sleep(200);
  await evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes("Quote Approved"));
    if (!option) throw new Error("Missing approved backlog status");
    option.click(); return true;
  })()`);
  await sleep(200);
  assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"] tbody tr').length`), 20, "Status filter uses saved snapshot rows");
  await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click(); true`);
  await sleep(200);
  await evaluate(`(() => {
    const params = new URLSearchParams({tab: "dashboard"});
    params.set("enquoteReportPeriod", JSON.stringify({
      range: {preset: "custom_range", start: "${BACKLOG_TODAY}", end: "${BACKLOG_TODAY}"}, mode: "period_total"
    }));
    location.hash = "#/SupervisorDashboard?" + params; return true;
  })()`);
  await sleep(1300);
  text = await tile();
  assert.ok(text?.split("\n").includes("39"), `Today displays new count: ${text}`);
  assert.match(text, /Live today/);
  await evaluate(`(() => {
    const params = new URLSearchParams({tab: "dashboard"});
    params.set("enquoteReportPeriod", JSON.stringify({
      range: {preset: "custom_range", start: "${BACKLOG_MISSING}", end: "${BACKLOG_MISSING}"}, mode: "period_total"
    }));
    location.hash = "#/SupervisorDashboard?" + params; return true;
  })()`);
  for (let attempt = 0; attempt < 40 && !/Live today/.test(await tile() || ""); attempt++) await sleep(150);
  text = await tile();
  assert.match(text, new RegExp(`No snapshot was saved for ${BACKLOG_MISSING}`), "Missing past snapshot is explained");
  assert.ok(text.split("\n").includes("39") && /Live today/.test(text), `Missing past snapshot falls back to today's live backlog: ${text}`);
  console.log("ok   Historical/live backlog, status breakdown, filtering, numeric overdue sorting");

  await evaluate(`(() => {
    window.__smokeCollections = {rmas: [], autoDrafterGeneratedDrafts: [], pvManufacturers: [{id:"smoke-panel-mfr", name:"Smoke Panels"}]};
    window.__smokePaidQuotes = [{id:"filter-existing",case_number:"existing",status:"rejected",is_current_version:false}];
    window.__smokeWorkTables = [{
      id: "quoteRequestCases", reportType: "quoteRequestCases",
      columns: ["Case Number", "Enlighten Site ID", "O&M Status", "Status", "Case Comment", "Case Comment Created By"],
      rows: [{"Case Number":"001234", "Enlighten Site ID":"005678", "O&M Status":"Quote Requested",
        Status:"Open", "Case Comment":"O&M_QUOTE_REQUEST\\nSite Information\\nSite ID: 005678\\nCase Number: 001234\\nRecommended Scope of Work\\nScope Description: Panel RMA replacement. Additional wiring required.\\nProducts\\nItem Name: IQ8A\\nQuantity: 1", "Case Comment Created By":"Smoke Requester"},
        {"Case Number":"filter-status","O&M Status":"Quote Pending Approval",Status:"Open","Case Comment":"O&M_QUOTE"},
        {"Case Number":"filter-closed","O&M Status":"Quote Requested",Status:"Closed","Case Comment":"O&M_QUOTE: Panel RMA only", "Case Comment Created By":"Panel Requester"},
        {"Case Number":"filter-marker","O&M Status":"Quote Requested",Status:"Open","Case Comment":"Ordinary comment"},
        {"Case Number":"existing","O&M Status":"Quote Requested",Status:"Open","Case Comment":"O&M_QUOTE"},
        {"Case Number":"alt-escalation","O&M Status":"",Status:"Open","Case Comment":"O&M_ESCALATION\\nEscalation Severity: Sev 2\\nSummary of Escalation\\nCustomer asked about a quote request delay.\\nEstimated Onsite Labor Hours: 4", "Case Comment Created By":"Escalation Author"},
        {"Case Number":"001234","O&M Status":"Quote Requested",Status:"Open","Case Comment":"O&M_RETURN\\nReturn Reason Category: Other", "Case Comment Created By":"Return Author"}]
    }];
    location.hash = "#/AutoDrafter"; return true;
  })()`);
  await sleep(2000);
  const caseTileCount = () => evaluate(`document.querySelectorAll('[data-enquote-share-target^="auto-drafter-case:"]').length`);
  assert.equal(await caseTileCount(), 4, "Every imported case without a real quote is listed");
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-enquote-share-target="auto-drafter-case:existing"]'))`), false, "A case that already has a Q-### quote is hidden");
  const tileHeights = await evaluate(`[...document.querySelectorAll('[data-enquote-share-target^="auto-drafter-case:"]')].map(node => Math.round(node.getBoundingClientRect().height))`);
  assert.ok(Math.max(...tileHeights) - Math.min(...tileHeights) <= 1, `Collapsed quote tiles share one size: ${tileHeights}`);
  assert.match(await evaluate("document.body.innerText"), /Quote Requests \(4\)/);
  await evaluate(`document.querySelector('[aria-label="Select request view"]').click(); true`);
  await sleep(200);
  assert.match(await evaluate(`document.querySelector('[role="listbox"][data-state="open"]').innerText`), /Alternate Requests \(2\)/);
  await evaluate(`[...document.querySelectorAll('[role="listbox"][data-state="open"] [role="option"]')].find(node => node.textContent.startsWith("Alternate Requests")).click(); true`);
  await sleep(300);
  const selectView = async label => {
    await evaluate(`document.querySelector('[aria-label="Select request view"]').click(); true`);
    await sleep(200);
    await evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="listbox"][data-state="open"] [role="option"]')].find(node => node.textContent.startsWith(${JSON.stringify(label)}));
      if (!option) throw new Error("Missing view: " + ${JSON.stringify(label)});
      option.click(); return true;
    })()`);
    await sleep(300);
  };
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-alternate-request]')].map(node => node.getAttribute('data-alternate-request')).sort()`),
    ["escalation", "return"], "Escalation and Return comments are listed as Alternate Requests");
  await evaluate(`document.querySelector('[data-alternate-filter="return"]').click(); true`);
  await sleep(150);
  assert.equal(await evaluate(`document.querySelectorAll('[data-alternate-request]').length`), 1, "Alternate Requests filter by type");
  await selectView("Quote Requests");
  assert.equal(await caseTileCount(), 4, "Alternate-only cases are not quote tiles");
  console.log("ok   Care Cancellation / Escalation / Return comments are separated into Alternate Requests");
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(node => /^Filters/.test(node.textContent.trim()))`), false, "Filters button is removed");
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.length`), 1, "Only the structured request without a real quote generates a draft automatically");
  const setFieldValue = (selector, value) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", {bubbles:true}));
    return true;
  })()`);
  await evaluate(`document.querySelector('[data-remove-case="filter-marker"]').click(); true`);
  await sleep(300);
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-remove-case-dialog]'))`), "Remove opens a reason dialog");
  await setFieldValue("#remove-case-note", "Customer declined");
  await evaluate(`document.querySelector('[data-confirm-remove-case]').click(); true`);
  await sleep(600);
  assert.equal(await caseTileCount(), 3, "A removed case leaves Quote Requests");
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.find(record => record.caseNumber === "filter-marker")?.removedFromAutoDrafter?.reason`),
    "quote_not_needed", "Removal reason is saved");
  await selectView("Removed Cases");
  assert.match(await evaluate(`document.querySelector('[data-removed-case="filter-marker"]')?.innerText || ""`), /Quote not needed[\s\S]*Customer declined/);
  await selectView("Request Outcomes");
  assert.match(await evaluate(`document.querySelector('[data-outcome-case="filter-marker"][data-outcome="removed"]')?.innerText || ""`),
    /Removed[\s\S]*Quote not needed[\s\S]*Customer declined/, "Request Outcomes shows where a removed case went, with its note");
  assert.ok(await evaluate(`document.querySelectorAll('[data-outcome="awaiting"]').length >= 1`), "Request Outcomes lists drafts awaiting review");
  await selectView("Removed Cases");
  await evaluate(`document.querySelector('[data-restore-case="filter-marker"]').click(); true`);
  await sleep(600);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.some(record => record.caseNumber === "filter-marker")`), false, "Restoring an undrafted case drops its placeholder");
  await selectView("Quote Requests");
  assert.equal(await caseTileCount(), 4, "A restored case returns to Quote Requests");
  console.log("ok   Cases can be removed from Auto-Drafter with a reason and restored");
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  assert.match(await evaluate("document.body.innerText"), /LPUP\/TPUP/);
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  console.log("ok   Auto-Drafter hides already-quoted cases and only drafts unquoted structured requests");
  assert.match(await evaluate("document.body.innerText"), /Panel RMA \+ On-Demand/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Request review"]').open`), false, "Tile review details are collapsed by default");
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  await sleep(200);
  assert.match(await evaluate("document.body.innerText"), /Intake review: Smoke Requester/);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-enquote-share-scope="groups"]'))`), false, "Expanding tile details does not open the quote");
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(node => node.textContent.trim() === "Classify request")`), false, "No manual classification button");
  const selectRequestType = async value => {
    await evaluate(`document.querySelector('[aria-label="Filter by request type"]').click(); true`);
    await sleep(200);
    await evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="listbox"][data-state="open"] [role="option"]')].find(node => node.getAttribute('data-value') === ${JSON.stringify(value)} || node.textContent.startsWith(${JSON.stringify(value)}));
      if (!option) throw new Error("Missing request type: " + ${JSON.stringify(value)});
      option.click(); return true;
    })()`);
    await sleep(200);
  };
  await selectRequestType("Panel RMA + On-Demand");
  assert.equal(await caseTileCount(), 1, "Mixed request filter retains mixed quote work");
  const workbookExport = await evaluate(`(async () => {
    let blob, fileName;
    const original = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = value => { blob = value; return "blob:smoke"; };
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    const label = document.querySelector('[data-auto-drafter-export]').innerText;
    try {
      document.querySelector('[data-auto-drafter-export]').click();
      for (let attempt = 0; attempt < 100 && !fileName; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    } finally { URL.createObjectURL = original; HTMLAnchorElement.prototype.click = click; }
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
    return {fileName, label, type: blob && blob.type, size: bytes.length, signature: String.fromCharCode(bytes[0], bytes[1])};
  })()`);
  assert.match(workbookExport.label, /Export Excel \(1\)/, "Export count follows the category filter");
  assert.match(workbookExport.fileName || "", /^auto-drafter-panel-rma-on-demand-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(workbookExport.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(workbookExport.signature, "PK", "Auto-Drafter export is a real .xlsx workbook");
  assert.ok(workbookExport.size > 4000, "Workbook includes the styled sheet");
  await selectRequestType("Panel RMA (");
  assert.equal(await caseTileCount(), 1, "RMA-only filter excludes mixed request");
  await selectRequestType("All request types");
  await click("Data Hygiene");
  assert.match(await evaluate(`document.querySelector('[role="dialog"][data-state="open"]').innerText`), /Smoke Requester/);
  assert.match(await evaluate(`document.querySelector('[role="dialog"][data-state="open"]').innerText`), /5 of 5 request cases/);
  assert.match(await evaluate(`document.querySelector('[role="dialog"][data-state="open"]').innerText`), /Needs verification in Salesforce/);
  await click("Close");
  await evaluate(`location.hash = "#/AutoDrafter?draftCase=001234"; true`);
  for (let attempt = 0; attempt < 40 && !(await evaluate(`Boolean(document.querySelector('[data-enphase-spec]'))`)); attempt++) await sleep(150);
  assert.equal(await evaluate(`document.querySelector('[data-enphase-spec]')?.dataset.enphaseSpec`), "iq8a", "IQ8A line shows its data sheet summary");
  assert.match(await evaluate(`document.querySelector('[data-enphase-spec]').innerText`), /max 11 per 20 A branch/);
  await click("Edit");
  await evaluate(`document.querySelector('button[title="Find in Catalog"]').click(); true`);
  await sleep(300);
  await evaluate(`(() => {
    const input = document.querySelector('[role="dialog"] input[placeholder="Search by name or SKU..."]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "disconnect tool");
    input.dispatchEvent(new Event("input", {bubbles: true})); return true;
  })()`);
  await sleep(300);
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-enphase-reference="q-disc-10"]'))`), "Find in Catalog shows the Enphase reference for unpriced products");
  await evaluate(`document.querySelector('[data-enphase-reference="q-disc-10"] button').click(); true`);
  await sleep(200);
  await evaluate(`(() => {
    const form = document.querySelector('[data-add-product-form]');
    const price = form.querySelector('[aria-label="Unit price"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(price, "12.50");
    price.dispatchEvent(new Event("input", {bubbles: true}));
    const category = form.querySelector('[aria-label="Category"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(category, "Wiring & Cable Management");
    category.dispatchEvent(new Event("change", {bubbles: true})); return true;
  })()`);
  await sleep(200);
  await evaluate(`document.querySelector('[data-add-product-form] button[type="submit"]').click(); true`);
  for (let attempt = 0; attempt < 40 && await evaluate(`Boolean(document.querySelector('[data-add-product-form]'))`); attempt++) await sleep(150);
  assert.deepEqual(await evaluate(`window.__smokeCollections.autoDrafterCustomProducts.map(row => [row.name, row.sku, row.unit_price])`),
    [["Enphase IQ Disconnect Tool", "Q-DISC-10", 12.5]], "Added product is saved to the catalog collection");
  assert.ok(await evaluate(`[...document.querySelectorAll('tbody input')].some(node => node.value === "Enphase IQ Disconnect Tool")`), "Added product replaces the line item");
  const lineCount = await evaluate(`document.querySelectorAll('tbody tr').length`);
  await click("Add Item");
  assert.match(await evaluate(`document.querySelector('[role="dialog"][data-state="open"]').innerText`), /Add Item from Catalog/, "Add Item opens the catalog instead of a free-text line");
  await evaluate(`document.querySelector('[data-add-product-plus]').click(); true`);
  await sleep(200);
  await evaluate(`(() => {
    const form = document.querySelector('[data-add-product-form]');
    const set = (selector, value, prototype) => {
      const node = form.querySelector(selector);
      Object.getOwnPropertyDescriptor(prototype.prototype, "value").set.call(node, value);
      node.dispatchEvent(new Event(prototype === HTMLSelectElement ? "change" : "input", {bubbles: true}));
    };
    set('[aria-label="Product name"]', "Smoke Conduit Strap", HTMLInputElement);
    set('[aria-label="Unit price"]', "3.25", HTMLInputElement);
    set('[aria-label="Category"]', "Wiring & Cable Management", HTMLSelectElement);
    return true;
  })()`);
  await sleep(200);
  await evaluate(`document.querySelector('[data-add-product-form] button[type="submit"]').click(); true`);
  for (let attempt = 0; attempt < 40 && await evaluate(`Boolean(document.querySelector('[data-add-product-form]'))`); attempt++) await sleep(150);
  assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length`), lineCount + 1, "Add Item appends one catalog line");
  assert.ok(await evaluate(`[...document.querySelectorAll('tbody input')].some(node => node.value === "Smoke Conduit Strap")`), "The + product is added as the new line");
  assert.ok(await evaluate(`[...document.querySelectorAll('tbody input')].some(node => node.value === "3.25")`), "New line uses the catalog price");
  await click("Cancel");
  console.log("ok   Enphase data sheet references and Add product in Find in Catalog");
  await evaluate(`location.hash = "#/SupervisorDashboard?tab=dashboard"; true`);
  for (let attempt = 0; attempt < 60 && !(await evaluate(`document.querySelectorAll('[data-hygiene-flags-chart] .recharts-bar-rectangle').length`)); attempt++) await sleep(150);
  assert.match(await evaluate("document.body.innerText"), /Most Common Data Hygiene Flags/);
  assert.ok(await evaluate(`document.querySelectorAll('[data-hygiene-flags-chart] .recharts-bar-rectangle').length`) > 0, "Overview shows the most common hygiene flags as bars");
  for (const selector of ['[data-backlog-flow-chart]', '[data-auto-drafter-accuracy]', '[data-panel-rma-cycle]']) {
    assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `Overview renders ${selector}`);
  }
  const accuracyText = () => evaluate(`document.querySelector('[data-auto-drafter-accuracy]').innerText`);
  for (let attempt = 0; attempt < 40 && /Loading/.test(await accuracyText()); attempt++) await sleep(150);
  assert.match(await accuracyText(), /Drafts generated\s+1\b/i, `Auto-Drafter accuracy counts generated drafts: ${await accuracyText()}`);
  assert.ok(await evaluate(`document.querySelectorAll('[data-tile-freshness]').length`) > 0, "Overview tiles show data freshness");
  assert.ok(await evaluate(`document.querySelectorAll('[data-tile-freshness="live"]').length`) > 0, "Live EnQuote tiles are labeled live");
  await evaluate(`location.hash = "#/SupervisorDashboard?tab=data-hygiene"; true`);
  await sleep(1800);
  assert.equal(await evaluate(`document.querySelector('[role="tab"][data-state="active"]').textContent.trim()`), "Data Hygiene", "Full supervisor subtab is selected by URL");
  assert.match(await evaluate("document.body.innerText"), /Requester \/ comment-author review/);
  assert.equal(await evaluate(`document.querySelectorAll('.recharts-wrapper').length`), 2, "Both author and issue charts render (trend waits for two days of history)");
  assert.match(await evaluate(`document.querySelector('[data-hygiene-trend-chart]').innerText`), /at least two different days/, "Trend explains it needs more history");
  assert.ok(await evaluate(`[...document.querySelectorAll('[data-heatmap-count]')].some(node => Number(node.dataset.heatmapCount) > 0)`), "Flags-by-person heatmap shows counts");
  for (let attempt = 0; attempt < 50 && !(await evaluate(`document.querySelectorAll('.recharts-label-list .recharts-label').length`)); attempt++) await sleep(150);
  assert.ok(await evaluate(`document.querySelectorAll('.recharts-label-list .recharts-label').length`) > 0, "Counts are rendered at bar ends");
  await evaluate(`document.querySelector('[aria-label="Filter hygiene by author"]').click(); true`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('[role="option"]')].find(node => node.textContent.startsWith("Smoke Requester")).click(); true`);
  await sleep(300);
  assert.equal(await evaluate(`[...document.querySelectorAll('tbody tr')].filter(node => !node.closest('[data-hygiene-heatmap]')).length`), 2, "Author filter narrows summary and request details");
  assert.match(await evaluate(`document.querySelector('[data-hygiene-export]').innerText`), /Export Excel \(1\)/);
  const exported = await evaluate(`(async () => {
    let blob, fileName;
    const original = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = value => { blob = value; return "blob:smoke"; };
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    try {
      document.querySelector('[data-hygiene-export]').click();
      for (let attempt = 0; attempt < 100 && !fileName; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      URL.createObjectURL = original; HTMLAnchorElement.prototype.click = click;
    }
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
    return {fileName, type: blob && blob.type, size: bytes.length, signature: String.fromCharCode(bytes[0], bytes[1]),
      error: document.querySelector('[role="alert"]')?.innerText || ""};
  })()`);
  assert.equal(exported.error, "", "Excel export reports no error");
  assert.match(exported.fileName || "", /^data-hygiene-smoke-requester-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(exported.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(exported.signature, "PK", "Export is a real .xlsx (zip) workbook");
  assert.ok(exported.size > 4000, "Workbook includes the styled sheets");
  await evaluate(`location.hash = "#/SupervisorDashboard?tab=snapshot-report"; true`);
  const previewText = () => evaluate(`document.querySelector('[data-snapshot-preview]')?.innerText || ""`);
  for (let attempt = 0; attempt < 60 && !/## Quotes\n/.test(await previewText()); attempt++) await sleep(150);
  const preview = await previewText();
  assert.match(preview, /^# O&M Daily Operations Snapshot/, "Snapshot preview renders");
  assert.ok(preview.indexOf("## Executive Summary") >= 0 && preview.indexOf("## Executive Summary") < preview.indexOf("## Quotes"), "Executive Summary leads the report");
  assert.match(preview, /_Source: EnQuote \(live\)/, "Quotes section cites live EnQuote data");
  assert.match(preview, /## Quote Requests\n_Source: Quote Request Cases with Case Comments/, `Snapshot uses the imported request report: ${preview}`);
  assert.doesNotMatch(preview, /CXone|NICE WFM|Blockers & Escalations|Final quality check/, "Legacy template sections are gone");
  const copied = await evaluate(`(async () => {
    let text = null;
    const original = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async value => { text = value; };
    try {
      document.querySelector('[data-snapshot-copy-markdown]').click();
      for (let attempt = 0; attempt < 40 && text === null; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    } finally { navigator.clipboard.writeText = original; }
    return text;
  })()`);
  assert.equal(copied?.split("\n").slice(3).join("\n"), (await previewText()).split("\n").slice(3).join("\n"), "Copy Markdown copies the previewed report");
  const snapshotDate = () => evaluate(`document.querySelector('[data-snapshot-date]')?.value || ""`);
  const startDate = await snapshotDate();
  assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/, "Snapshot shows the report date picker");
  await evaluate(`document.querySelector('[data-snapshot-date-picker] [aria-label="Previous day"]').click(); true`);
  await sleep(300);
  const priorDate = await snapshotDate();
  const expectedPrior = new Date(Date.UTC(...startDate.split("-").map((part, index) => Number(part) - (index === 1 ? 1 : 0))) - 86400000).toISOString().slice(0, 10);
  assert.equal(priorDate, expectedPrior, "Previous day moves the report back one day");
  const priorLabel = new Date(Date.UTC(...priorDate.split("-").map((part, index) => Number(part) - (index === 1 ? 1 : 0)), 12))
    .toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric", timeZone: "UTC"});
  assert.ok((await previewText()).startsWith(`# O&M Daily Operations Snapshot \u2014 ${priorLabel}`), `Preview follows the picked date (${priorLabel})`);
  await evaluate(`document.querySelector('[data-snapshot-date-picker] [aria-label="Next day"]').click(); true`);
  await sleep(300);
  assert.equal(await snapshotDate(), startDate, "Next day returns to the original date");
  await evaluate(`location.hash = "#/SupervisorDashboard?tab=data-hygiene"; true`);
  await sleep(1200);
  await click("Import request report");
  assert.match(await evaluate(`document.querySelector('[role="dialog"][data-state="open"]').innerText`), /Quote Request Cases/);
  await click("Close");
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.length`), 1, "Navigation and filtering never overwrite or duplicate generated draft");
  console.log("ok   Automatic panel badges, request-type separation, hygiene author flags and full supervisor charts subtab");
  await click("Submit Panel RMA");
  assert.equal(await evaluate(`document.querySelector('#rma-case')?.value`), "001234", "Case is prefilled");
  assert.equal(await evaluate(`document.querySelector('#rma-site')?.value`), "005678", "Site is prefilled");
  assert.equal(await evaluate(`window.__smokeCollections.rmas.length`), 0, "No submission before form confirmation");
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(node => node.textContent.trim() === "Next").disabled`), true);
  await evaluate(`document.querySelector('[aria-label="Panel Manufacturer"]').click(); true`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Smoke Panels").click(); true`);
  await click("Next");
  assert.match(await evaluate("document.body.innerText"), /Step 2 of 4/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Panel Manufacturer"]').closest('[hidden]') !== null`), true, "Manufacturer belongs to step 1");
  await click("Next");
  assert.match(await evaluate("document.body.innerText"), /Step 3 of 4/);
  await click("Open Claim form");
  assert.equal(await evaluate(`window.__smokeCalls["panelRmaForms.open"]`), 1, "Manufacturer website opens via isolated desktop bridge");
  await evaluate(`window.__smokeMissingPanelFormHandler = true; true`);
  await click("Open Claim form");
  assert.match(await evaluate("document.body.innerText"), /stop the desktop:dev terminal.*Reloading the page does not load/);
  await evaluate(`window.__smokeMissingPanelFormHandler = false; true`);
  await click("Open Claim form");
  await click("Add manufacturer form");
  await evaluate(`(() => {
    const node = document.getElementById("manufacturer-saved-form-url");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(node,"https://manufacturer.example/reusable");
    node.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  })()`);
  await click("Save form for this manufacturer");
  await sleep(500);
  await click("Open Warranty claim form");
  assert.ok(await evaluate(`(async () => (await window.enquoteLocal.sops.list()).some(doc =>
    doc.title === "Smoke Panels Panel RMA Forms" && doc.content_html.includes("/reusable")))()`), "Reusable forms persist independently of RMA");
  await click("Add manufacturer form");
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.4 blank form"],"Blank warranty.pdf",{type:"application/pdf"}));
    const input = document.getElementById("manufacturer-form-file");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
    window.__smokeSopSaveError = "Manufacturer forms could not be saved";
    return true;
  })()`);
  await click("Save form for this manufacturer");
  assert.match(await evaluate("document.body.innerText"), /Manufacturer forms could not be saved/);
  await evaluate(`window.__smokeSopSaveError = ""; true`);
  await click("Save form for this manufacturer");
  await sleep(500);
  assert.match(await evaluate("document.body.innerText"), /Open saved form: Blank warranty.pdf/);
  assert.ok(await evaluate(`(async () => (await window.enquoteLocal.sops.list()).some(doc =>
    doc.title === "Smoke Panels Panel RMA Forms" && doc.files.some(file => file.name === "Blank warranty.pdf") && doc.content_html.includes("/reusable")))()`),
    "Upload appends a form without losing saved portal links");
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="Panel RMA SOP page"]');
    select.value = "panel-rma-smoke";
    select.dispatchEvent(new Event("change", {bubbles:true}));
    return true;
  })()`);
  await sleep(200);
  await click("Add suggested checklist");
  const checklistCount = await evaluate(`document.querySelectorAll('[aria-label="SOP-guided Panel RMA preparation"] input[type="checkbox"]').length`);
  assert.equal(checklistCount, 3, "Actual SOP instructions become review checklist");
  await evaluate(`document.querySelector('[aria-label="SOP-guided Panel RMA preparation"] input[type="checkbox"]').click(); true`);
  await evaluate(`window.__smokeRmaClipboardFail = true; true`);
  await click("Copy submission draft");
  assert.match(await evaluate("document.body.innerText"), /RMA clipboard unavailable/);
  await evaluate(`window.__smokeRmaClipboardFail = false; true`);
  await click("Copy submission draft");
  assert.match(await evaluate("window.__smokeRmaClipboard"), /Case 001234/);
  assert.match(await evaluate("window.__smokeRmaClipboard"), /Standard RMA Submission Steps/);
  assert.equal(await evaluate("window.__smokeCollections.rmas.length"), 0, "Copying never saves or submits an RMA");
  await evaluate(`window.__smokeRmaSopRefreshFail = true; true`);
  await click("Refresh SOP guidance");
  assert.match(await evaluate("document.body.innerText"), /SOP refresh unavailable/);
  await evaluate(`(async () => {
    window.__smokeRmaSopRefreshFail = false;
    window.__smokeSopDocs = (await window.enquoteLocal.sops.list()).map(doc =>
      doc.id === "panel-rma-smoke" ? {...doc, updated_date:"2026-10-14T00:00:00Z"} : doc);
    return true;
  })()`);
  await click("Refresh SOP guidance");
  assert.match(await evaluate("document.body.innerText"), /Source changed or unavailable; review it again/);
  await click("Use this SOP as a reference");
  assert.equal(await evaluate(`document.body.innerText.includes("Source changed or unavailable; review it again")`), false);
  await click("Back");
  await evaluate(`(() => {
    for (const [id, value] of Object.entries({"rma-model":"P400", "rma-quantity":"2", "rma-number":"M-400", "rma-serials":"SN1\\nSN2"})) {
      const node = document.getElementById(id);
      if (!node) throw new Error("Missing RMA field: " + id);
      const prototype = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
      node.dispatchEvent(new Event("input", {bubbles:true}));
    }
    return true;
  })()`);
  await click("Next");
  await click("Next");
  assert.match(await evaluate("document.body.innerText"), /Step 4 of 4/);
  await click("Create RMA");
  await sleep(700);
  const records = await evaluate(`structuredClone(window.__smokeCollections.rmas)`);
  assert.equal(records.length, 1);
  assert.equal(records[0].panel_quantity, 2);
  assert.equal(records[0].serial_numbers, "SN1\nSN2");
  assert.equal(records[0].source_category, "panel_rma");
  assert.equal(records[0].submission_preparation.sources[0].id, "panel-rma-smoke");
  assert.equal(records[0].submission_preparation.checklist["Gather panel model and serial numbers."], true);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.length`), 1,
    "Panel RMA does not remove the automatically generated quote draft for additional wiring");
  await sleep(400);
  assert.match(await evaluate(`[...document.querySelectorAll('[data-panel-rma-badge]')].map(node => node.textContent).join("|")`),
    /PV RMA · New/, "Auto-Drafter tiles show that a PV RMA exists for the case");
  await click("Panel RMA: New");
  await click("Next"); await click("Next");
  await click("Open Warranty claim form");
  await click("Back"); await click("Back");
  assert.equal(await evaluate(`document.querySelector('#rma-model')?.value`), "P400", "Existing case reopens persisted RMA");
  await evaluate(`window.__smokeCollections.rmas[0].updated_date = "changed-by-teammate"; true`);
  await click("Next"); await click("Next"); await click("Next");
  await click("Update RMA");
  assert.match(await evaluate("document.body.innerText"), /changed while you were editing/, "Concurrent change is shown explicitly");
  assert.ok(await evaluate(`Boolean(document.querySelector('#rma-model'))`), "Rejected edit remains open");
  await click("Cancel");
  await click("Panel RMA: New");
  await click("Next"); await click("Next"); await click("Next");
  await click("Update RMA");
  await sleep(500);
  assert.equal(await evaluate(`Boolean(document.querySelector('#rma-model'))`), false, "Successful save closes the form");
  assert.equal(await evaluate(`window.__smokeCollections.rmas.length`), 1, "Repeated submission edits, not duplicates");
  await evaluate(`location.hash = "#/PVPanelRMAs"; true`);
  await sleep(1600);
  await click("List View");
  text = await evaluate("document.body.innerText");
  assert.match(text, /P400/);
  assert.match(text, /M-400/);
  await evaluate(`(() => {
    window.__smokePaidQuotes = [{id:"rma-quote", quote_number:"RMA-Q1", case_number:"001234", site_id:"005678",
      status:"draft", created_date:"2026-10-01T00:00:00Z", updated_date:"2026-10-13T00:00:00Z",
      line_items:[], status_history:[], quote_requester:"smoke.test@enphaseenergy.com"}];
    location.hash = "#/QuoteDetails?id=rma-quote"; return true;
  })()`);
  await sleep(1800);
  await click("Submit / Edit Panel RMA");
  await click("Next"); await click("Next"); await click("Next");
  await click("Update RMA");
  await sleep(500);
  assert.equal(await evaluate(`window.__smokeCollections.rmas[0].source_quote_id`), "rma-quote");
  assert.equal(await evaluate(`window.__smokeCollections.rmas.length`), 1, "Quote intake reuses the same case record");
  await evaluate(`location.hash = "#/PVPanelRMAs"; true`);
  await sleep(1300);
  await click("List View");
  assert.ok(await evaluate(`Boolean([...document.querySelectorAll('a')].find(node => node.textContent === "RMA-Q1" && node.href.includes("rma-quote")))`),
    "Tracker links the originating quote");
  await evaluate(`location.hash = "#/Quotes"; true`);
  await sleep(1500);
  assert.match(await evaluate(`document.querySelector('[data-quote-card-panel-rma]')?.innerText || ""`), /PV RMA · New/,
    "Quotes page tiles show that a PV RMA exists for the quote");
  await evaluate(`delete navigator.clipboard; delete window.__smokeRmaClipboard; delete window.__smokeRmaClipboardFail; true`);
  console.log("ok   SOP checklist, source-change warning, refresh errors, draft copying and clipboard recovery");
  console.log("ok   Prefilled Panel RMA, extra fields, save/reopen, no duplicates, independent drafting and tracker");
  await evaluate(`(() => {
    window.__smokePaidQuotes = [];
    window.__smokeSavedDraftReference = window.__smokeCollections.autoDrafterGeneratedDrafts[0].quoteNumber;
    window.__smokeWorkTables[0].rows[0]["Case Comment"] =
      "10/1 - PS: Quote Request\\nSite Information\\nSite ID: 005678\\nCase Number: 001234\\nRecommended Scope of Work\\nScope Description: Replace Enphase microinverters and IQ Gateway.\\nLabor\\nEstimated Onsite Labor Hours: 3-4\\nProducts\\nItem Name: IQ8A\\nQuantity: 1\\nSerial Number: 123456789012";
    window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours = 34;
    window.__smokeLargeTables = {care_subscriptions:{columns:["Enlighten Site Id","Subscription Status","Created Dt"],
      rows:[{"Enlighten Site Id":"005678","Subscription Status":"ACTIVE","Created Dt":"2026-10-01"}]}};
    location.hash = "#/AutoDrafter"; return true;
  })()`);
  await sleep(1600);
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  await sleep(100);
  text = await evaluate("document.body.innerText");
  assert.match(text, /Microinverter RMA review/);
  assert.equal(await evaluate(`[...document.querySelectorAll('div,span')].some(node => node.textContent === "LPUP/TPUP")`), false, "Replacement-only microinverters do not get a purchase badge");
  assert.match(text, /Gateway\/Envoy: check warranty/);
  assert.match(text, /Enphase Care/);
  assert.doesNotMatch(text, /Inside Sales: Care upsell/);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].quoteNumber === window.__smokeSavedDraftReference`), true, "Revised report does not overwrite saved draft");
  for (let attempt = 0; attempt < 30 && await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours`) !== 4; attempt++) await sleep(100);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours`), 4, "Unedited draft with joined range digits is corrected automatically");
  assert.match(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].parseWarnings.join(" ")`), /Automatically corrected .*Labor hours 34 → 4/);
  assert.equal(await evaluate(`Boolean(window.__smokeCollections.autoDrafterGeneratedDrafts[0].editedBeforeSend)`), false, "Automatic correction is not a reviewer edit");
  await evaluate(`(() => {
    Object.assign(window.__smokeCollections.autoDrafterGeneratedDrafts[0], {editedBeforeSend: true});
    window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours = 34;
    location.hash = "#/Quotes"; return true;
  })()`);
  await sleep(500);
  await evaluate(`location.hash = "#/AutoDrafter?draftCase=001234"; true`);
  await sleep(1000);
  text = await evaluate("document.body.innerText");
  assert.match(text, /Active Enphase Care/);
  assert.match(text, /Saved values are higher than the request allows: Labor hours 34 → 4/);
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-source-input-mismatch]'))`), "Reviewer-edited drafts keep a one-click correction instead");
  await evaluate(`document.querySelector('[data-apply-source-inputs]').click(); true`);
  for (let attempt = 0; attempt < 30 && await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours`) !== 4; attempt++) await sleep(100);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts[0].draft.labor_hours`), 4, "Apply request values saves the upper bound");
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-source-input-mismatch]'))`), false, "Mismatch card clears once corrected");
  text = await evaluate("document.body.innerText");
  assert.match(text, /request comment changed after this draft was generated/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Routing flag explanations"]').open`), false, "Detailed routing guidance is expandable so quote contents stay tidy");
  await evaluate(`document.querySelector('[aria-label="Routing flag explanations"] > summary').click(); true`);
  assert.equal(await evaluate(`(() => {
    const quote = document.querySelector('[data-enquote-share-scope="groups"]');
    const review = quote?.querySelector('[aria-label="Request review"]');
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === "Submit / Edit Panel RMA");
    return Boolean(review && review.contains(button) && review.innerText.includes("Verify device warranty"));
  })()`), true, "Review reasons and actions are inside the quote, not floating above its layout");
  await evaluate(`document.querySelector('[aria-label="Routing flag explanations"] > summary').click(); true`);
  if (process.env.ENQUOTE_SMOKE_SCREENSHOT) {
    require("node:fs").writeFileSync(process.env.ENQUOTE_SMOKE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  win.setSize(600, 900);
  await sleep(300);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, "Review layout has no horizontal overflow at narrow width");
  win.setSize(1440, 900);
  await evaluate(`window.__smokeLargeTables.care_subscriptions.rows[0]["Subscription Status"] = "EXPIRED"; location.hash = "#/PVPanelRMAs"; true`);
  await sleep(500);
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  assert.match(await evaluate("document.body.innerText"), /Inside Sales: Care upsell/);
  await evaluate(`window.__smokeLargeTables.care_subscriptions.rows = []; location.hash = "#/PVPanelRMAs"; true`);
  await sleep(500);
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  await evaluate(`document.querySelector('[aria-label="Request review"] > summary').click(); true`);
  assert.match(await evaluate("document.body.innerText"), /Verify Care \/ Inside Sales review/);
  assert.equal(await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.length`), 1);
  console.log("ok   Automatic review drafts, preservation, LPUP/TPUP, Gateway warranty exception and three-state Care/Inside Sales routing");
  await evaluate(`(() => {
    const scopes = [
      ["panel", "Panel RMA only"],
      ["enphase", "Replace Enphase microinverters"],
      ["enphase-second", "Replace Enphase microinverters"],
      ["enphase-third", "Replace Enphase microinverters"],
      ["upgrade", "Upgrade Enphase microinverters"],
      ["panel-mixed", "Panel RMA plus additional wiring"],
      ["enphase-mixed", "Replace Enphase microinverters and repair wiring"],
      ["review", "Inspect solar panels for damage"],
      ["other", "Repair AC cabling"],
      ["module-only", "Replace failed equipment"],
      ["module-mixed", "Replace failed equipment and provide mounting hardware"],
      ["care", "Enphase Care enrollment quote and enrollment service."]
    ];
    window.__smokeWorkTables[0].rows = scopes.map(([key, scope]) => ({
      "Case Number": "category-" + key, "Enlighten Site ID": "005678",
      "O&M Status": "Quote Requested", Status: "Open", "Case Comment Created By": "Category Requester",
      "Case Comment": "Quote Requests\\nSite ID: 005678\\nCase Number: category-" + key + "\\nScope Description: " + scope +
        (key.startsWith("module-") ? "\\nRMA Required: No\\nProducts\\nItem Name: Compatible Replacement PV Module\\nQuantity: 1" : "") +
        (key === "module-mixed" ? "\\nAdditional Materials\\nItem Name: Mounting Hardware\\nQuantity: 1" : "") +
        (key === "care" ? "\\nProducts\\nNone required\\nServices\\nService Name: Enphase Care Enrollment\\nQuantity: 1" : "")
    }));
    location.hash = "#/PVPanelRMAs"; return true;
  })()`);
  await sleep(400);
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  assert.equal(await caseTileCount(), 12);
  assert.ok(await evaluate(`Boolean(document.querySelector('[aria-label="Select request view"]'))`), "View dropdown replaces the three section buttons");
  await selectRequestType("All request types");
  await evaluate(`document.querySelector('[aria-label="Filter by request type"]').click(); true`);
  await sleep(200);
  const counts = await evaluate(`[...document.querySelectorAll('[role="listbox"][data-state="open"] [role="option"]')].slice(2).map(node => Number(node.textContent.match(/\\((\\d+)\\)$/)[1]))`);
  assert.deepEqual(counts, [...counts].sort((a,b) => b-a), "Case categories are ordered largest to smallest");
  await evaluate(`document.querySelector('[aria-label="Filter by request type"]').dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true})); true`);
  await sleep(200);
  for (const [category, count] of [["Panel RMA (", 2], ["Enphase RMA (", 3], ["LPUP/TPUP (", 1],
    ["Panel RMA + On-Demand", 2], ["Enphase RMA + On-Demand", 1], ["Enphase Care", 1], ["On-Demand only", 2], ["Unclassified", 0]]) {
    await selectRequestType(category);
    assert.equal(await caseTileCount(), count, `${category} isolates its matching cases`);
  }
  const chooseDialogOption = async (trigger, label) => {
    await evaluate(`document.querySelector(${JSON.stringify(trigger)}).click(); true`);
    await sleep(200);
    await evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="listbox"][data-state="open"] [role="option"]')].find(node => node.textContent.startsWith(${JSON.stringify(label)}));
      if (!option) throw new Error("Missing option: " + ${JSON.stringify(label)});
      option.click(); return true;
    })()`);
    await sleep(200);
  };
  const openCategoryCorrection = async caseNumber => {
    await evaluate(`document.querySelector('[data-enquote-share-target="auto-drafter-case:${caseNumber}"] [aria-label="Request review"] > summary').click(); true`);
    await sleep(200);
    await evaluate(`document.querySelector('[data-enquote-share-target="auto-drafter-case:${caseNumber}"] [data-correct-category]').click(); true`);
    await sleep(300);
    assert.ok(await evaluate(`Boolean(document.querySelector('[data-category-correction-dialog]'))`), "Correct category opens the correction dialog");
  };
  await selectRequestType("All request types");
  await openCategoryCorrection("category-other");
  await chooseDialogOption("#category-correction-type", "Enphase RMA");
  await evaluate(`document.querySelector('[data-category-teach]').click(); true`);
  await sleep(150);
  await setFieldValue("#category-rule-phrase", "Repair AC cabling");
  await evaluate(`document.querySelector('[data-confirm-category-correction]').click(); true`);
  await sleep(1200);
  assert.deepEqual(await evaluate(`(window.__smokeCollections.autoDrafterLearnedSwaps || []).filter(record => String(record.kind).startsWith("category_")).map(record => record.kind + ":" + record.category).sort()`),
    ["category_case:enphase_rma", "category_rule:enphase_rma"], "Case correction and learned rule are saved");
  await selectRequestType("Enphase RMA (");
  assert.equal(await caseTileCount(), 4, "The corrected case moves to its new category");
  await openCategoryCorrection("category-other");
  assert.match(await evaluate(`document.querySelector('[data-category-learned]').innerText`), /corrected/);
  await evaluate(`document.querySelector('[data-category-reset]').click(); true`);
  await sleep(1200);
  assert.equal(await caseTileCount(), 4, "The learned rule still categorizes the case after its per-case correction is reset");
  await openCategoryCorrection("category-other");
  assert.match(await evaluate(`document.querySelector('[data-category-learned]').innerText`), /Learned rule: "Repair AC cabling"/);
  await evaluate(`document.querySelector('[data-category-forget-rule]').click(); true`);
  await sleep(1200);
  assert.equal(await caseTileCount(), 3, "Forgetting the rule restores the automatic category");
  assert.equal(await evaluate(`(window.__smokeCollections.autoDrafterLearnedSwaps || []).filter(record => String(record.kind).startsWith("category_")).length`), 0);
  console.log("ok   Wrong categories can be corrected per case and taught as reusable rules");
  await selectRequestType("All request types");
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Request review"][open]').length`), 0, "All tiles start minimal");
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="option"], button')].some(node => /Improper/.test(node.textContent))`), false, "Improper Requests is retired");
  await selectView("Panel RMA Requests");
  assert.equal(await caseTileCount(), 0, "Panel RMA record view is distinct from quote tiles");
  assert.equal(await evaluate(`window.__smokeCollections.rmas.length`), 1, "View changes preserve tracker records");
  await selectView("Quote Requests");
  assert.equal(await caseTileCount(), 12);
  if (process.env.ENQUOTE_SMOKE_TILE_SCREENSHOT) {
    require("node:fs").writeFileSync(process.env.ENQUOTE_SMOKE_TILE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  console.log("ok   Eight mutually exclusive case categories and minimal expandable tiles");
  await evaluate(`(() => {
    const draft = {scope_of_work: "Repair AC cabling", items: [{name: "AC Cabling", quantity: 1, unit_price: 50}], labor_hours: 2, travel_hours: 1, miles_traveled: 20};
    const quote = (id, caseNumber, status) => ({...draft, id, quote_number: id.toUpperCase(), case_number: caseNumber, site_id: "005678",
      status, status_history: [{status: "submitted", changed_at: "2026-10-01T01:00:00Z"}, {status, changed_at: "2026-10-02T01:00:00Z"}], is_current_version: true, created_date: "2026-10-01T00:00:00Z", created_by_email: "smoke@example.com"});
    window.__smokePaidQuotes = [quote("golden-quote", "golden-1", "approved"), quote("pending-quote", "golden-2", "submitted")];
    const record = (caseNumber, quoteId) => ({id: caseNumber, caseNumber, draft, sentToQuotes: true, realQuoteId: quoteId,
      sentAt: "2026-10-01T00:00:00Z", sourceComment: "Repair AC cabling",
      requestSnapshot: {category: "on_demand", categoryLabel: "On-Demand only", hygieneFlagCount: 0, author: "Category Requester"}});
    window.__smokeCollections.autoDrafterGeneratedDrafts.push(record("golden-1", "golden-quote"), record("golden-2", "pending-quote"));
    location.hash = "#/PVPanelRMAs"; return true;
  })()`);
  await sleep(400);
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  await selectView("Golden Quotes");
  assert.equal(await caseTileCount(), 1, "Only the approved, unedited, clean quote is Golden");
  assert.equal(await evaluate(`document.querySelectorAll('.golden-quote-card').length`), 1);
  assert.match(await evaluate("document.body.innerText"), /SOP followed perfectly/);
  await selectView("Quote Requests");
  await evaluate(`location.hash = "#/Quotes"; true`);
  await sleep(1500);
  const goldenButton = `[...document.querySelectorAll('button')].find(node => node.textContent.includes("Golden Quotes"))`;
  for (let attempt = 0; attempt < 40 && !(await evaluate(`Boolean(${goldenButton}) || /Something went wrong/.test(document.body.innerText)`)); attempt++) await sleep(150);
  assert.match(await evaluate(`${goldenButton}?.textContent || ""`), /Golden Quotes \(1\)/);
  assert.equal(await evaluate(`document.querySelectorAll('.golden-quote-card').length`), 1, "Quotes page highlights the Golden Quote");
  await evaluate(`${goldenButton}.click(); true`);
  await sleep(400);
  assert.equal(await evaluate(`${goldenButton}.getAttribute("aria-pressed")`), "true");
  assert.match(await evaluate("document.body.innerText"), /GOLDEN-QUOTE/);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /PENDING-QUOTE/, "Golden filter hides non-Golden quotes");
  if (process.env.ENQUOTE_SMOKE_GOLDEN_SCREENSHOT) {
    require("node:fs").writeFileSync(process.env.ENQUOTE_SMOKE_GOLDEN_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  await evaluate(`${goldenButton}.click(); true`);
  console.log("ok   Golden Quotes appear on Auto-Drafter and the Quotes page only when the SOP was followed perfectly");

  await evaluate(`location.hash = "#/PVPanelRMAs"; true`);
  await sleep(1300);
  // Real mouse input: the browser decides whether a click submits the form after React re-renders.
  const realClick = async text => {
    const point = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return null;
      button.scrollIntoView({block:"center"});
      const rect = button.getBoundingClientRect();
      return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
    })()`);
    assert.ok(point, `Button exists: ${text}`);
    win.webContents.sendInputEvent({type:"mouseDown", x:point.x, y:point.y, button:"left", clickCount:1});
    win.webContents.sendInputEvent({type:"mouseUp", x:point.x, y:point.y, button:"left", clickCount:1});
    await sleep(500);
  };
  await click("List View");
  await evaluate(`document.querySelector('tbody tr').click(); true`);
  await sleep(500);
  const statusBefore = await evaluate(`window.__smokeCollections.rmas[0].current_status`);
  await realClick("Next"); await realClick("Next"); await realClick("Next");
  assert.match(await evaluate("document.body.innerText"), /Step 4 of 4/, "Step 4 stays open after a real click on Next");
  assert.ok(await evaluate(`Boolean(document.querySelector('[role="dialog"][data-state="open"]'))`), "RMA dialog stays open on step 4");
  assert.equal(await evaluate(`window.__smokeCollections.rmas[0].current_status`), statusBefore, "Reaching step 4 does not save");
  console.log("ok   RMA wizard: real clicks reach step 4 without auto-saving or closing");
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true})); true`);
  await sleep(400);
  const newStatus = statusBefore === "Manufacturer Reviewing" ? "Waiting for Customer" : "Manufacturer Reviewing";
  await evaluate(`(() => {
    const select = document.querySelector('[data-rma-status-select]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(newStatus)});
    select.dispatchEvent(new Event("change", {bubbles:true}));
    return true;
  })()`);
  await sleep(700);
  const statusRecord = await evaluate(`(() => {
    const rma = window.__smokeCollections.rmas[0];
    return {status: rma.current_status, last: (rma.status_history || []).at(-1) || null, dialog: Boolean(document.querySelector('[role="dialog"][data-state="open"]'))};
  })()`);
  assert.equal(statusRecord.status, newStatus, "Inline status change saves the RMA");
  assert.equal(statusRecord.last?.new_status, newStatus, "Inline status change is recorded in status history");
  assert.equal(statusRecord.last?.previous_status, statusBefore);
  assert.equal(statusRecord.dialog, false, "Changing status inline does not open the wizard");
  console.log("ok   RMA list changes status inline with history");
  await sleep(300);
  await click("Wizard Settings");
  await sleep(300);
  await evaluate(`document.querySelector('[data-rma-settings-manufacturer="Smoke Panels"]').click(); true`);
  await sleep(200);
  await evaluate(`document.querySelector('#rma-settings-method').click(); true`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Email").click(); true`);
  await sleep(200);
  await evaluate(`document.querySelector('[data-save-rma-settings]').click(); true`);
  await sleep(200);
  assert.match(await evaluate("document.body.innerText"), /Add at least one To email address/, "Email method requires a recipient");
  await setFieldValue("#rma-settings-to", "claims@smoke-panels.example");
  await setFieldValue("#rma-settings-instructions", "Attach the flash test report.");
  await evaluate(`document.querySelector('[data-save-rma-settings]').click(); true`);
  await sleep(600);
  assert.deepEqual(await evaluate(`(() => {
    const record = window.__smokeCollections.pvManufacturers.find(item => item.name === "Smoke Panels");
    return [record.rma_submission_method, record.rma_email_to];
  })()`), ["email", "claims@smoke-panels.example"], "Wizard settings are saved on the manufacturer");
  await evaluate(`location.hash = "#/AutoDrafter"; true`);
  await sleep(1500);
  await click("Submit Panel RMA");
  await evaluate(`document.querySelector('[aria-label="Panel Manufacturer"]').click(); true`);
  await sleep(200);
  await evaluate(`[...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Smoke Panels").click(); true`);
  await click("Next");
  await click("Next");
  const emailBlock = await evaluate(`document.querySelector('[data-rma-email-submission]')?.innerText || ""`);
  assert.match(emailBlock, /claims@smoke-panels\.example/, "Email manufacturers show the configured recipient");
  assert.match(await evaluate(`document.querySelector('[data-rma-config-instructions]')?.innerText || ""`), /flash test report/);
  await evaluate(`window.__smokeOpened = []; window.open = url => {window.__smokeOpened.push(url); return null;}; true`);
  await click("Open in email app");
  assert.match(await evaluate(`window.__smokeOpened[0] || ""`), /^mailto:claims%40smoke-panels\.example\?subject=Panel%20RMA%20request/, "Email opens through a mailto link");
  assert.equal(await evaluate(`window.__smokeCollections.rmas.length`), 1, "Opening the email does not save an RMA");
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true})); true`);
  console.log("ok   RMA Wizard Settings configure email submission for a manufacturer");
}

// Measures Auto-Drafter dialog responsiveness with a large report (ENQUOTE_PERF_PROBE=1).
async function runAutoDrafterPerfProbe(win, evaluate) {
  const caseCount = Number(process.env.ENQUOTE_PERF_PROBE_CASES) || 400;
  await evaluate(`(() => {
    window.__smokeCollections = {rmas: [], autoDrafterGeneratedDrafts: [], pvManufacturers: []};
    window.__smokePaidQuotes = [];
    const rows = [];
    for (let i = 0; i < ${caseCount}; i++) rows.push({"Case Number": String(100000 + i), "Enlighten Site ID": String(500000 + i),
      "O&M Status": "Quote Requested", Status: "Open", "Case Comment Created By": "Perf Requester",
      "Case Comment": "O&M_QUOTE_REQUEST\\nSite Information\\nSite ID: " + (500000 + i) + "\\nCase Number: " + (100000 + i) +
        "\\nRecommended Scope of Work\\nScope Description: Replace microinverters and wiring on array " + i +
        ".\\nProducts\\nItem Name: IQ8A\\nQuantity: 3\\nItem Name: Q Cable\\nQuantity: 2"});
    window.__smokeWorkTables = [{id: "quoteRequestCases", reportType: "quoteRequestCases",
      columns: ["Case Number", "Enlighten Site ID", "O&M Status", "Status", "Case Comment", "Case Comment Created By"], rows}];
    location.hash = "#/AutoDrafter"; return true;
  })()`);
  let previous = -1, stable = 0;
  for (let attempt = 0; attempt < 300; attempt++) {
    await sleep(1000);
    const drafts = await evaluate(`window.__smokeCollections.autoDrafterGeneratedDrafts.length`);
    stable = drafts === previous ? stable + 1 : 0;
    if (drafts >= caseCount || stable >= 5) break;
    previous = drafts;
  }
  await sleep(1500);
  const profiling = Boolean(process.env.ENQUOTE_PERF_PROFILE);
  if (profiling) {
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Profiler.enable");
    await win.webContents.debugger.sendCommand("Profiler.setSamplingInterval", {interval: 200});
    await win.webContents.debugger.sendCommand("Profiler.start");
  }
  const domInfo = await evaluate(`(() => {
    const all = document.querySelectorAll('*').length;
    const top = [...document.querySelectorAll('body *')]
      .map(el => ({el, n: el.getElementsByTagName('*').length}))
      .filter(x => x.n > all * 0.15 && x.n < all * 0.95)
      .sort((a, b) => a.n - b.n).slice(0, 8)
      .map(x => x.el.tagName + '.' + String(x.el.className).slice(0, 60) + ' [' + [...x.el.attributes].map(a => a.name).filter(n => n.startsWith('data-')).join(',') + '] = ' + x.n);
    const svg = document.querySelectorAll('svg').length;
    const styleSheets = document.styleSheets.length;
    const anims = document.getAnimations().map(a => (a.animationName || a.constructor.name) + '@' + (a.effect && a.effect.target ? (a.effect.target.className && String(a.effect.target.className).slice(0, 40)) : ''));
    const animSummary = Object.entries(anims.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    let t0 = performance.now();
    for (let i = 0; i < 5; i++) { document.body.style.setProperty('--perf-probe', String(i)); getComputedStyle(document.body).animationName; }
    const bodyVarRecalc = (performance.now() - t0) / 5;
    t0 = performance.now();
    for (let i = 0; i < 5; i++) { document.body.classList.toggle('perf-probe'); document.body.offsetHeight; }
    const classLayout = (performance.now() - t0) / 5;
    const rules = [...document.styleSheets].reduce((s, sh) => { try { return s + sh.cssRules.length; } catch { return s; } }, 0);
    return JSON.stringify({all, svg, styleSheets, rules, anims: anims.length, animSummary, bodyVarRecalc, classLayout, top});
  })()`);
  console.log(`perf-dom ${domInfo}`);
  const result = await evaluate(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const tiles = document.querySelectorAll('[data-enquote-share-target^="auto-drafter-case:"]').length;
    let t = performance.now();
    document.querySelector('[data-remove-case]').click();
    while (!document.querySelector('[data-remove-case-dialog] textarea')) await frame();
    await frame();
    const openMs = performance.now() - t;
    const textarea = document.querySelector('[data-remove-case-dialog] textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const sample = "Customer already handled this ok";
    let text = "";
    let dispatchTotal = 0;
    t = performance.now();
    for (const character of sample) {
      text += character;
      setter.call(textarea, text);
      const before = performance.now();
      textarea.dispatchEvent(new Event("input", {bubbles: true}));
      dispatchTotal += performance.now() - before;
      await frame();
    }
    const keystrokeMs = (performance.now() - t) / sample.length;
    const dispatchMs = dispatchTotal / sample.length;
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    t = performance.now();
    while (document.querySelector('[data-remove-case-dialog]')) await frame();
    const closeMs = performance.now() - t;
    return {tiles, drafts: window.__smokeCollections.autoDrafterGeneratedDrafts.length,
      openMs: Math.round(openMs), keystrokeMs: Math.round(keystrokeMs * 10) / 10, dispatchMs: Math.round(dispatchMs * 10) / 10, closeMs: Math.round(closeMs)};
  })()`);
  console.log(`perf ${JSON.stringify(result)}`);
  if (profiling) {
    const {profile} = await win.webContents.debugger.sendCommand("Profiler.stop");
    const deltas = new Map();
    profile.samples.forEach((id, index) => deltas.set(id, (deltas.get(id) || 0) + (profile.timeDeltas[index] || 0)));
    const self = new Map();
    for (const node of profile.nodes) {
      const frame = node.callFrame;
      const key = `${frame.functionName || "(anonymous)"} ${String(frame.url).split("/").pop()}:${frame.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (deltas.get(node.id) || 0) / 1000);
    }
    [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
      .forEach(([key, ms]) => console.log(`prof ${ms.toFixed(0).padStart(7)}ms ${key}`));
  }
}

module.exports = {runBacklogRma};
