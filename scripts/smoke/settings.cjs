const assert = require("node:assert/strict");
const {BrowserWindow, clipboard} = require("electron");
const path = require("node:path");
const {inspectSalesforceCase} = require("../../electron/salesforceCaseInspector.cjs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runSettings(win) {
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function waitFor(code, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${description}: ${await evaluate(`(() => {
      const panel=document.querySelector('[data-salesforce-panel]');
      return JSON.stringify({expanded: panel?.dataset.expanded, width: panel?.getBoundingClientRect().width,
        resize: document.querySelector('[aria-label="Resize Salesforce panel"]')?.getAttribute("aria-valuenow"),
        preparation: document.querySelector('[aria-label="Prepare Homeowner Quote"]')?.textContent});
    })()`)}`);
  }
  await evaluate(`location.hash="#/Settings"; true`);
  await waitFor(`Boolean(document.querySelector("#show-Quotes"))`, "Settings page");
  assert.equal(await evaluate(`(() => {
    const cloud = document.querySelector('[aria-label="Open Salesforce workspace"]');
    const rect = cloud.getBoundingClientRect();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.style.cssText = "position:fixed;inset:0;z-index:50;background:black";
    document.body.append(dialog);
    const covered = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === dialog;
    dialog.remove();
    return covered;
  })()`), true, "normal dialogs cover the tucked-away Salesforce launcher");
  await evaluate(`window.__smokePaidQuotes = [{
    id:"attachment-quote",quote_number:"Q-ATTACH",customer:"Jane Doe",site_id:"123",case_number:"456",
    status:"draft",created_date:"2026-10-01T00:00:00Z",items:[],status_history:[],total:0
  }]; location.hash="#/QuoteDetails?id=attachment-quote"; true`);
  await waitFor(`Boolean(document.querySelector('[aria-label="Quote downloads"]'))`, "quote details");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Quote downloads"]').textContent.includes("Prepare for Salesforce")`), false);
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "Salesforce opened for preparation");
  const fixtureContents = win.contentView.children[0].webContents;
  const loadDeadline = Date.now() + 15000;
  while ((!fixtureContents.getURL() || fixtureContents.isLoadingMainFrame()) && Date.now() < loadDeadline) await sleep(100);
  assert.equal(fixtureContents.isLoadingMainFrame(), false);
  await fixtureContents.executeJavaScript(`document.querySelector("#fixture-case").style.display="none"; true`);
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Open the case from the search results")`, "search page gives actionable guidance");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Generate Quote"]'))`), false);
  await fixtureContents.executeJavaScript(`history.pushState({}, "", "/lightning/r/Case/500fixture/view");
    setTimeout(() => {document.querySelector("#fixture-case").style.display="";}, 600); true`);
  const generateReady = `Boolean(document.querySelector('[aria-label="Generate Quote"]') && !document.querySelector('[aria-label="Generate Quote"]').disabled)`;
  const clickGenerate = async () => {
    await waitFor(generateReady, "toolbar Generate Quote ready");
    await evaluate(`document.querySelector('[aria-label="Generate Quote"]').click(); true`);
  };
  await waitFor(generateReady, "Salesforce automatically matches quote and homeowner");
  await sleep(2200);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label^="Drag PDF:"]'))`), false, "detection must not generate a PDF");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Prepare Homeowner Quote"]'))`), false, "detection must not open dropdown");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-salesforce-panel] header button')).find(button=>button.textContent==="Prepare Homeowner Quote").nextElementSibling.getAttribute("aria-label")`), "Generate Quote");
  const inspectScript = `(${inspectSalesforceCase.toString()})()`;
  const scanWork = await fixtureContents.executeJavaScript(`(() => {
    const noise = document.createElement("div");
    noise.innerHTML = "<span>Unrelated Salesforce content</span>".repeat(2000);
    document.body.append(noise);
    const originalStyle = window.getComputedStyle;
    const originalQuery = document.querySelectorAll;
    const styled = new Set();
    let styleCalls = 0, documentQueries = 0;
    window.getComputedStyle = element => { styleCalls++; styled.add(element); return originalStyle(element); };
    document.querySelectorAll = function(selector) { documentQueries++; return originalQuery.call(this, selector); };
    try {
      const start = performance.now();
      const context = ${inspectScript};
      return {context, styleCalls, uniqueStyled: styled.size, documentQueries, durationMs: performance.now() - start};
    } finally {
      window.getComputedStyle = originalStyle;
      document.querySelectorAll = originalQuery;
      noise.remove();
    }
  })()`);
  assert.equal(scanWork.context.caseNumber, "456", "large pages preserve case identification");
  assert.equal(scanWork.styleCalls, scanWork.uniqueStyled, "each element's computed style is read at most once per scan");
  assert.equal(scanWork.documentQueries, 1, "each scan enumerates the document only once");
  console.log("ok   Salesforce scan work bounded on 2,000 extra elements:", scanWork);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript), {caseNumber: "456", siteId: "123", contactName: "Jane Doe"});
  await fixtureContents.executeJavaScript(`(() => {
    const link=document.querySelector('#fixture-case a[href="/contact"]');
    const host=document.createElement("span"); host.id="slotted-contact";
    link.replaceWith(host); host.append(link);
    host.attachShadow({mode:"open"}).innerHTML='<slot></slot>';
  })(); true`);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript),
    {caseNumber: "456", siteId: "123", contactName: "Jane Doe"},
    "Salesforce contact links with role=button and slotted text remain readable without preview text");
  await fixtureContents.executeJavaScript(`(() => {
    const host=document.querySelector("#slotted-contact");
    host.replaceWith(host.querySelector("a"));
  })(); true`);
  await fixtureContents.executeJavaScript(`(() => {
    const host=document.createElement("div"); host.id="shadow-case";
    host.attachShadow({mode:"open"}).innerHTML=document.querySelector("#fixture-case").outerHTML;
    document.querySelector("#fixture-case").style.display="none";
    document.body.append(host);
  })(); true`);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript), {caseNumber: "456", siteId: "123", contactName: "Jane Doe"}, "open shadow roots and hidden tabs are handled");
  await fixtureContents.executeJavaScript(`document.querySelector("#shadow-case").remove(); document.querySelector("#fixture-case").style.display=""; true`);
  await fixtureContents.executeJavaScript(`(() => {
    const copy=document.querySelector("#fixture-case").cloneNode(true); copy.id="conflicting-case";
    copy.querySelector("lightning-formatted-text").textContent="999"; document.body.append(copy);
  })(); true`);
  const ambiguity = await fixtureContents.executeJavaScript(`(() => {
    try { ${inspectScript}; return ""; } catch (error) { return error.message; }
  })()`);
  assert.match(ambiguity, /Multiple visible Salesforce cases/);
  await fixtureContents.executeJavaScript(`document.querySelector("#conflicting-case").remove(); true`);
  const realRecordPath = "/lightning/r/Case/500Ps00001PqE9dIAF/view";
  await evaluate(`window.__smokePaidQuotes.push({...window.__smokePaidQuotes[0],id:"plain-record-quote",
    quote_number:"Q-PLAIN",case_number:"20715990",site_id:"4720152",customer:"Abram Sanchez"}); true`);
  await fixtureContents.executeJavaScript(`(() => {
    const fixture=document.querySelector("#fixture-case");
    fixture.style.display="none";
    const record=document.createElement("main"); record.id="plain-record";
    record.dataset.recordid="500Ps00001PqE9dIAF";
    record.innerHTML='<section><div><p>Case Number</p><div><span>20715990</span></div></div>' +
      '<div><span>Contact Name</span><div><a href="/contact/abram">Abram Sanchez</a><button>Preview</button></div></div>' +
      '<div><span>Enlighten Site ID</span><div>4720152</div></div></section>' +
      '<p>Description</p><p>Other case 99999999, site 8888888 and gateway 202331115081 are historical notes.</p>';
    document.body.append(record);
    history.pushState({}, "", ${JSON.stringify(realRecordPath)});
  })(); true`);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript),
    {caseNumber: "20715990", siteId: "4720152", contactName: "Abram Sanchez"},
    "record URL scopes plain labeled outputs and excludes numbers from description");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-PLAIN")`, "plain record layout detects matching quote");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Abram Sanchez - Quote - Q-PLAIN.pdf"]'))`,
    "plain record layout generates matching quote PDF on click");
  await fixtureContents.executeJavaScript(`document.querySelector("#fixture-case").style.display=""; true`);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript),
    {caseNumber: "20715990", siteId: "4720152", contactName: "Abram Sanchez"},
    "record ID excludes another cached case even when its layout remains rendered");
  await fixtureContents.executeJavaScript(`(() => {
    const tab=document.createElement("button"); tab.id="selected-fixture-tab"; tab.setAttribute("role","tab");
    tab.setAttribute("aria-selected","true"); tab.setAttribute("aria-controls","fixture-case");
    tab.textContent="456 | Case"; document.body.prepend(tab);
  })(); true`);
  assert.deepEqual(await fixtureContents.executeJavaScript(inspectScript),
    {caseNumber: "456", siteId: "123", contactName: "Jane Doe"},
    "selected console tab outranks stale record URL");
  const searchPath = "/one/one.app#" + Buffer.from(JSON.stringify({
    componentDef: "forceSearch:searchPageDesktop", attributes: {term: "20715990"}
  })).toString("base64");
  await fixtureContents.executeJavaScript(`history.pushState({}, "", ${JSON.stringify(searchPath)}); true`);
  const searchError = await fixtureContents.executeJavaScript(`(() => {
    try { ${inspectScript}; return ""; } catch (error) { return error.message; }
  })()`);
  assert.match(searchError, /Open the case from the search results/, "search results must not reuse cached record fields");
  await fixtureContents.executeJavaScript(`document.querySelector("#plain-record").remove();
    document.querySelector("#selected-fixture-tab").remove();
    history.pushState({}, "", "/lightning/r/Case/500fixture/view"); true`);
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-ATTACH")`, "return to original quote after record tests");
  await fixtureContents.executeJavaScript(`document.querySelector("#fixture-case a").textContent="Changed Contact"; true`);
  await evaluate(`document.querySelector('[aria-label="Reload Salesforce"]').click(); true`);
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-ATTACH")`, "toolbar reload rereads case");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Jane Doe - Quote - Q-ATTACH.pdf"]'))`, "generated customer PDF chip");
  await waitFor(`!document.querySelector('[aria-label="Prepare Homeowner Quote"]')`, "preparation completes without dropdown");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Drag PDF: Jane Doe - Quote - Q-ATTACH.pdf"]').draggable`), true);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Show prepared PDF in folder"]'))`), true);
  await evaluate(`document.querySelector('[aria-label="Copy homeowner email"]').click(); true`);
  await waitFor(`Array.from(document.querySelectorAll('[data-sonner-toast]')).some(item => item.textContent.includes("Homeowner email copied"))`, "copy email success");
  await waitFor(`Array.from(document.querySelectorAll('[data-salesforce-notice]')).some(item => item.textContent.includes("Homeowner email copied"))`, "notification shown inside the drawer");
  await sleep(400);
  const notice = await evaluate(`(() => {
    const strip=document.querySelector('[aria-label="Notifications"]').getBoundingClientRect();
    const page=document.querySelector('[data-salesforce-content]').getBoundingClientRect();
    return {above:strip.bottom<=page.top, floatingHidden:getComputedStyle(document.querySelector('[data-sonner-toaster]')).visibility==="hidden"};
  })()`);
  assert.equal(notice.above, true, "drawer notifications sit above the native Salesforce page, never behind it");
  assert.equal(notice.floatingHidden, true, "floating toasts are hidden while Salesforce would cover them");
  const noticeBottom = await evaluate(`document.querySelector('[data-salesforce-content]').getBoundingClientRect().top`);
  assert.ok(win.contentView.children[0].getBounds().y >= Math.round(noticeBottom * win.webContents.getZoomFactor()) - 1,
    "native Salesforce view moves below the notification strip");
  await waitFor(`document.querySelector('[aria-label="Email clipboard confirmation"]')?.textContent.trim() === "Copied to clipboard"`, "toolbar clipboard popup");
  const confirmation = await evaluate(`(() => {
    const notice=document.querySelector('[aria-label="Email clipboard confirmation"]').getBoundingClientRect();
    const toolbar=document.querySelector('[data-salesforce-panel] header').getBoundingClientRect();
    return {inside:notice.top>=toolbar.top && notice.bottom<=toolbar.bottom};
  })()`);
  assert.equal(confirmation.inside, true, "clipboard popup stays above the native Salesforce view");
  assert.match(await clipboard.readText(), /Hello Jane Doe,/);
  assert.equal((await clipboard.readText()).split("\n")[0], "Subject: Enphase Energy - On - Demand Quote - Jane Doe - 123");
  await evaluate(`Array.from(document.querySelectorAll('[data-salesforce-panel] button')).find(button=>button.textContent==="Prepare Homeowner Quote").click(); true`);
  await waitFor(`Boolean(document.querySelector("#attachment-homeowner"))`, "manual name input");
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Prepare Homeowner Quote"] select').length`), 0, "dropdown only edits homeowner name");
  await evaluate(`(() => {const input=document.querySelector("#attachment-homeowner"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Janet Smith"); input.dispatchEvent(new Event("input",{bubbles:true}));})(); true`);
  await waitFor(`document.querySelector('[aria-label="Prepare Homeowner Quote"]').textContent.includes("Janet Smith - Quote - Q-ATTACH.pdf")`, "manual filename preview");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Janet Smith - Quote - Q-ATTACH.pdf"]')) && !document.querySelector('[aria-label="Prepare Homeowner Quote"]')`, "manually named PDF");
  await evaluate(`document.querySelector('[aria-label="Copy homeowner email"]').click(); true`);
  await sleep(200);
  assert.match(await clipboard.readText(), /Hello Janet Smith,/);
  await evaluate(`window.__smokePaidQuotes.push({...window.__smokePaidQuotes[0],id:"auto-site-quote",
    quote_number:"Q-AUTO",case_number:"777",site_id:"789",customer:"Saved Name"}); true`);
  await fixtureContents.executeJavaScript(`(() => {
    document.querySelector("#fixture-case").dataset.casePanel="true";
    const tabs=document.createElement("div"); tabs.id="console-case-tabs"; tabs.setAttribute("role","tablist");
    document.body.prepend(tabs);
  })(); true`);
  const changeCase = (number, site, name) => fixtureContents.executeJavaScript(`(() => {
    const panelId=${number === "456" ? '"fixture-case"' : JSON.stringify(`cached-case-${number}`)};
    let root=document.getElementById(panelId);
    if (!root) {
      root=document.querySelector("#fixture-case").cloneNode(true);
      root.id=panelId; document.body.append(root);
    }
    root.querySelector("lightning-formatted-text").textContent=${JSON.stringify(number)};
    root.querySelector('a[href="/contact"]').innerHTML=${JSON.stringify(`${name}<span class="slds-assistive-text"> Preview</span>`)};
    root.querySelector("records-record-layout-block:last-child").innerHTML=
      '<div class="site-status"><span>Site ID</span> · <a href="/site">${site}</a></div>';
    let tab=document.querySelector('[aria-controls="'+panelId+'"]');
    if (!tab) {
      tab=document.createElement("button"); tab.setAttribute("role","tab");
      tab.setAttribute("aria-controls",panelId); tab.textContent=${JSON.stringify(number)};
      tab.onclick=() => {
        for (const panel of document.querySelectorAll("[data-case-panel]")) {
          const selected=panel.id===panelId;
          panel.setAttribute("aria-hidden",String(!selected));
          panel.style.display=selected ? "" : "none";
        }
        for (const item of document.querySelectorAll("#console-case-tabs button")) {
          item.setAttribute("aria-selected",String(item===tab));
        }
      };
      document.querySelector("#console-case-tabs").append(tab);
    }
    tab.click();
  })(); true`);
  await changeCase("888", "789", "New Homeowner");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-AUTO")`, "same-URL case change detects unique site match with form closed");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label^="Drag PDF:"]'))`), false, "new case clears old PDF and waits for Generate");
  await sleep(2200);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label^="Drag PDF:"]'))`), false, "stable detection still must not auto-generate");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: New Homeowner - Quote - Q-AUTO.pdf"]'))`, "Generate prepares the new case");
  await evaluate(`document.querySelector('[aria-label="Copy homeowner email"]').click(); true`);
  await sleep(200);
  assert.match(await clipboard.readText(), /Hello New Homeowner,/);
  assert.equal((await clipboard.readText()).split("\n")[0], "Subject: Enphase Energy - On - Demand Quote - New Homeowner - 789");
  assert.match(await clipboard.readText(), /invoice sent to you/);
  assert.doesNotMatch(await clipboard.readText(), /Jane Doe|Preview/);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Prepare Homeowner Quote"]'))`), false, "generation does not require the form");
  await sleep(2200);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Drag PDF: New Homeowner - Quote - Q-AUTO.pdf"]'))`), true, "stable case keeps its PDF available");
  await waitFor(`!document.querySelector('[aria-label="Email clipboard confirmation"]')`, "clipboard confirmation dismisses automatically");
  await evaluate(`Array.from(document.querySelectorAll('[data-salesforce-panel] button')).find(button=>button.textContent==="Prepare Homeowner Quote").click(); true`);
  await waitFor(`document.querySelector("#attachment-homeowner")?.value === "New Homeowner"`, "manual form on current case");
  await changeCase("900", "901", "No Quote Homeowner");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent === "No Quote Found" &&
    !document.querySelector('[aria-label^="Drag PDF:"]')`, "no quote clears the previous case PDF");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Copy homeowner email"]'))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Generate Quote"]'))`), false);
  await evaluate(`window.__smokePaidQuotes.push({...window.__smokePaidQuotes.find(quote=>quote.id==="auto-site-quote"),id:"duplicate-site"}); true`);
  await changeCase("889", "789", "Ambiguous Homeowner");
  await waitFor(`Boolean(document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Multiple")) &&
    !document.querySelector('[aria-label^="Drag PDF:"]')`, "ambiguous site does not prepare or reuse a PDF");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Generate Quote"]'))`), false);
  await changeCase("456", "123", "Jane Doe");
  await waitFor(`document.querySelector("#attachment-homeowner")?.value === "Jane Doe"`, "switching case resets manual homeowner override");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Jane Doe - Quote - Q-ATTACH.pdf"]'))`, "returning to a case and generating its PDF");
  await evaluate(`window.__smokeQuoteReadDelays={"auto-site-quote":6500};
    window.__smokePaidQuotes=window.__smokePaidQuotes.filter(quote=>quote.id!=="duplicate-site"); true`);
  await changeCase("888", "789", "New Homeowner");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent === "Finding quote for case 888..."`, "slow quote preparation starts");
  await waitFor(`window.__smokePendingQuoteReads?.["auto-site-quote"] > 0`, "previous-case quote request is pending");
  await changeCase("456", "123", "Jane Doe");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-ATTACH")`, "tab scan continues while previous quote request is pending");
  assert.ok(await evaluate(`window.__smokePendingQuoteReads?.["auto-site-quote"] > 0`), "new case detected before the delayed previous-case request completes");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Jane Doe - Quote - Q-ATTACH.pdf"]'))`, "Generate current case while old detection is pending");
  await sleep(6800);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Drag PDF: Jane Doe - Quote - Q-ATTACH.pdf"]'))`), true, "late previous-case request cannot replace the active case PDF");
  await evaluate(`window.__smokeQuoteReadDelays={}; true`);
  await evaluate(`window.__smokeQuoteReadDelays={"attachment-quote":6500}; true`);
  await clickGenerate();
  await waitFor(`window.__smokePendingQuoteReads?.["attachment-quote"] > 0`, "generation waits for fresh quote");
  await changeCase("888", "789", "New Homeowner");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-AUTO")`, "tab change detected during explicit generation");
  await waitFor(generateReady, "old generation completes without publishing its PDF");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label^="Drag PDF:"]'))`), false, "discard old-case generation and wait for a new click");
  await evaluate(`window.__smokeQuoteReadDelays={};
    window.__smokePaidQuotes.push({...window.__smokePaidQuotes[0],id:"missing-name",quote_number:"Q-NAME",
      case_number:"902",site_id:"903",customer:""}); true`);
  await changeCase("902", "903", "");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Homeowner name needed")`, "missing name has an actionable explanation");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Generate Quote"]').disabled`), false, "missing name must not leave Generate greyed out");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector("#attachment-homeowner"))`, "name-only editor for missing name");
  assert.equal(await evaluate(`document.activeElement.id`), "attachment-homeowner", "Generate focuses the missing name field");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label^="Drag PDF:"]'))`), false, "missing name must not generate a nameless PDF");
  await evaluate(`(() => {const input=document.querySelector("#attachment-homeowner"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Manual Homeowner"); input.dispatchEvent(new Event("input",{bubbles:true}));})(); true`);
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Manual Homeowner - Quote - Q-NAME.pdf"]'))`, "manual name enables toolbar generation");
  await evaluate(`window.__smokePaidQuotes.push({...window.__smokePaidQuotes[0],id:"saved-name",
    quote_number:"Q-SAVED-NAME",case_number:"904",site_id:"905",customer:"Saved Homeowner"}); true`);
  await changeCase("904", "905", "");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-SAVED-NAME")`, "saved quote homeowner used when Salesforce contact is not readable");
  await clickGenerate();
  await waitFor(`Boolean(document.querySelector('[aria-label="Drag PDF: Saved Homeowner - Quote - Q-SAVED-NAME.pdf"]'))`, "missing Salesforce contact does not block PDF with saved homeowner");
  await changeCase("456", "123", "Jane Doe");
  await waitFor(`document.querySelector('[aria-label="Salesforce quote status"]')?.textContent.includes("Q-ATTACH")`, "restore original case");
  await evaluate(`document.querySelector('[aria-label="Tuck away Salesforce"]').click(); location.hash="#/Settings"; true`);
  await waitFor(`Boolean(document.querySelector("#show-Quotes"))`, "Settings after PDF preparation");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]') !== null`), true);
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "workspace slide-out");
  await sleep(300);
  const view = win.contentView.children[0];
  assert.ok(view, "Salesforce is an actual native view within EnQuote, not a separate window");
  async function assertAligned(label) {
    const deadline = Date.now() + 2500;
    let last;
    while (Date.now() < deadline) {
      const [contentWidth, contentHeight] = win.getContentSize();
      const rect = await evaluate(`(() => {
        const rect=document.querySelector('[data-salesforce-content]').getBoundingClientRect();
        return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight};
      })()`);
      const scaleX = contentWidth / rect.viewportWidth, scaleY = contentHeight / rect.viewportHeight;
      const bounds = view.getBounds();
      last = {scaleX, scaleY, rect, bounds, visible: view.getVisible()};
      if (last.visible && Math.abs(bounds.x-Math.round(rect.x*scaleX))<=1 && Math.abs(bounds.y-Math.round(rect.y*scaleY))<=1 &&
          Math.abs(bounds.width-Math.round(rect.width*scaleX))<=1 && Math.abs(bounds.height-Math.round(rect.height*scaleY))<=1) return;
      await sleep(100);
    }
    assert.fail(`Salesforce misaligned after ${label}: ${JSON.stringify(last)}`);
  }
  // In-app zoom (the 100% control / Ctrl +/-) while Salesforce stays open.
  for (const zoom of [0.8, 0.9, 1.1, 1.25, 1.5, 1]) {
    win.webContents.setZoomFactor(zoom);
    await assertAligned(`zooming to ${zoom * 100}% while open`);
  }
  const getZoomFactor = win.webContents.getZoomFactor;
  try {
    win.webContents.getZoomFactor = () => 0.8;
    const stale = view.getBounds();
    view.setBounds({...stale, x: Math.round(stale.x * 0.8), width: Math.round(stale.width * 0.8)});
    await assertAligned("a configured zoom that disagrees with the renderer viewport");
  } finally {
    win.webContents.getZoomFactor = getZoomFactor;
  }
  // Rapid zoom steps, like clicking + several times quickly.
  for (const zoom of [1.1, 1.2, 1.3, 1.2, 1.1]) { win.webContents.setZoomFactor(zoom); await sleep(30); }
  await assertAligned("rapid zoom clicks");
  win.webContents.setZoomFactor(1);
  // Window resizing while open.
  const [originalWindowWidth, originalWindowHeight] = win.getSize();
  for (const [w, h] of [[1100, 760], [1500, 900], [originalWindowWidth, originalWindowHeight]]) {
    win.setSize(w, h);
    await assertAligned(`resizing the window to ${w}x${h}`);
  }
  for (const zoom of [0.8, 1.25, 1]) {
    win.webContents.setZoomFactor(zoom);
    await sleep(300);
    await evaluate(`document.querySelector('[aria-label="Tuck away Salesforce"]').click(); true`);
    await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "true"`, "hide before alignment check");
    await sleep(300);
    await evaluate(`document.querySelector('[data-salesforce-panel]').style.transitionDelay="200ms";
      document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
    await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "reopen with delayed slide");
    await sleep(100);
    assert.equal(view.getVisible(), false, "Salesforce stays hidden while the drawer is still sliding");
    await assertAligned(`reopening at ${zoom * 100}% with a delayed slide`);
    // Simulate a stale mid-slide position like the 1.4.1 report; the watchdog must snap it back.
    const stale = view.getBounds();
    view.setBounds({...stale, x: stale.x + 75, width: Math.max(1, stale.width - 75)});
    await assertAligned(`a stale offset at ${zoom * 100}%`);
    await evaluate(`document.querySelector('[data-salesforce-panel]').style.transitionDelay=""; true`);
  }
  await view.webContents.executeJavaScript(`document.querySelector("input").value="Keep these case notes"; true`);
  const pageId = view.webContents.id;
  assert.equal(view.webContents.getURL(), "https://enphase.lightning.force.com/lightning/r/Case/500fixture/view");
  const focusWidth = view.getBounds().width;
  assert.ok(focusWidth > 0, `Salesforce view must have visible bounds: ${JSON.stringify({
    bounds: view.getBounds(),
    rectangle: await evaluate(`(() => {const element=document.querySelector('[data-salesforce-panel]'); const rect=element.getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,transform:getComputedStyle(element).transform, viewport:innerWidth};})()`)
  })}`);
  assert.equal(await evaluate(`document.querySelector('[data-salesforce-panel]').dataset.expanded`), "true");
  const viewportWidth = await evaluate("innerWidth");
  assert.ok(focusWidth > viewportWidth * 0.85, "Focus view should use most of the viewport");
  const chrome = await evaluate(`(() => {
    const backdrop = document.querySelector('[data-salesforce-backdrop]');
    const cloud = document.querySelector('[aria-label="Open Salesforce workspace"]');
    const rect = cloud.getBoundingClientRect();
    return {
      backdropOpacity: getComputedStyle(backdrop).opacity,
      cloudAccessible: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === cloud ||
        cloud.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      headerHeight: document.querySelector('[data-salesforce-panel] header').getBoundingClientRect().height
    };
  })()`);
  assert.equal(chrome.backdropOpacity, "1");
  assert.equal(chrome.cloudAccessible, true, "cloud remains above the dimmed background");
  assert.equal(chrome.headerHeight, 40, "toolbar stays compact");
  await evaluate(`document.querySelector('[aria-label="Restore Salesforce panel"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').dataset.expanded === "false"`, "restore saved width");
  await sleep(300);
  const originalWidth = view.getBounds().width;
  assert.equal(originalWidth, 942, "restored width excludes content padding and panel border");
  await evaluate(`document.querySelector('[aria-label="Expand Salesforce panel"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').dataset.expanded === "true"`, "expand focus view");
  await sleep(300);
  assert.equal(view.getBounds().width, focusWidth);
  assert.equal(await view.webContents.executeJavaScript(`document.querySelector("input").value`), "Keep these case notes");
  // Dragging or keyboard resizing a focus view returns to the resizable layout.
  await evaluate(`document.querySelector('[aria-label="Resize Salesforce panel"]').dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true})); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').dataset.expanded === "false"`, "resize exits expanded mode");
  await evaluate(`document.querySelector('[aria-label="Expand Salesforce panel"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').dataset.expanded === "true"`, "restore focus for dismissal");
  view.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "true"`, "Escape from native page tucks panel away");
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "cloud restores focus");
  await sleep(300);
  win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, x: 12, y: 200});
  win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, x: 12, y: 200});
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "true"`, "background click dismisses focus view");
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "cloud restores after background dismissal");
  assert.equal(await view.webContents.executeJavaScript(`document.querySelector("input").value`), "Keep these case notes");
  // Reset the saved width before exercising the original drag/keyboard regression checks.
  await evaluate(`(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("enquote_app_preferences_v1::"));
    const value = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({...value, salesforcePanelWidth:960, salesforcePanelExpanded:false}));
    dispatchEvent(new Event("enquote_app_preferences_changed"));
  })(); true`);
  await waitFor(`document.querySelector('[aria-label="Resize Salesforce panel"]').getAttribute("aria-valuenow") === "960"`, "saved width reset");
  await evaluate(`document.querySelector('[aria-label="Resize Salesforce panel"]').dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true})); true`);
  await waitFor(`document.querySelector('[aria-label="Resize Salesforce panel"]').getAttribute("aria-valuenow") === "920"`, "keyboard resize");
  await sleep(300);
  assert.equal(view.getBounds().width, originalWidth - 40, "resizing updates the actual native view");
  const handle = await evaluate(`(() => {const rect=document.querySelector('[aria-label="Resize Salesforce panel"]').getBoundingClientRect(); return {x:Math.round(rect.x+4),y:100};})()`);
  win.webContents.sendInputEvent({type: "mouseMove", x: handle.x, y: handle.y});
  win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, x: handle.x, y: handle.y});
  win.webContents.sendInputEvent({type: "mouseMove", x: handle.x - 80, y: handle.y});
  win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, x: handle.x - 80, y: handle.y});
  await waitFor(`document.querySelector('[aria-label="Resize Salesforce panel"]').getAttribute("aria-valuenow") === "1000"`, "pointer drag resizing");
  await sleep(300);
  assert.equal(view.getBounds().width, originalWidth + 40, "dragging the left edge resizes the native page");
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "true"`, "cloud tucks away panel");
  await sleep(300);
  assert.equal(win.contentView.children.length, 0, "native page detaches after slide-out");
  await evaluate(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "cloud restores panel");
  assert.equal(win.contentView.children[0].webContents.id, pageId);
  assert.equal(await view.webContents.executeJavaScript(`document.querySelector("input").value`), "Keep these case notes");
  await evaluate(`location.hash="#/AutoDrafter"; true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]')?.getAttribute("aria-hidden") === "false"`, "open drawer survives page navigation");
  assert.equal(win.contentView.children[0].webContents.id, pageId);
  await evaluate(`document.querySelector('[aria-label="Tuck away Salesforce"]').click(); true`);
  await waitFor(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "true"`, "toolbar tucks away panel");
  await evaluate(`location.hash="#/Settings"; true`);
  await waitFor(`Boolean(document.querySelector("#show-Quotes"))`, "Settings after drawer navigation");
  await evaluate(`document.querySelector("#show-Quotes").click(); true`);
  await waitFor(`!document.querySelector('aside a[href="#/Quotes"]')`, "hidden Quotes tab");
  assert.equal(await evaluate(`Boolean(document.querySelector('aside a[href="#/Settings"]'))`), true);
  await evaluate(`document.querySelector("#salesforce-launcher").click(); true`);
  await waitFor(`!document.querySelector('[aria-label="Open Salesforce workspace"]')`, "hidden launcher");
  await evaluate(`location.hash="#/Quotes"; true`);
  await waitFor(`document.querySelector("main")?.innerText.includes("Quotes")`, "hidden page remains accessible");
  assert.equal(await evaluate(`document.body.innerText.includes("Access Not Granted")`), false);
  await evaluate(`location.hash="#/Settings"; true`);
  await waitFor(`Boolean(document.querySelector("#show-Quotes"))`, "Settings remount");
  assert.equal(await evaluate(`document.querySelector("#show-Quotes").getAttribute("aria-checked")`), "false");
  assert.equal(await evaluate(`document.querySelector("#salesforce-launcher").getAttribute("aria-checked")`), "false");
  await evaluate(`document.querySelector("#salesforce-launcher").click(); true`);
  await waitFor(`Boolean(document.querySelector('[aria-label="Open Salesforce workspace"]'))`, "restored launcher");
  await evaluate(`document.querySelector("#show-Quotes").click(); true`);
  await waitFor(`Boolean(document.querySelector('aside a[href="#/Quotes"]'))`, "restored Quotes tab");

  for (const page of ["Dashboard", "AutoDrafter", "Tasks", "Messages"]) {
    await evaluate(`location.hash="#/${page}"; true`);
    await waitFor(`Boolean(document.querySelector('aside a[href="#/${page}"][class*="bg-orange-50"]'))`, `${page} navigation`);
    await waitFor(`Boolean(document.querySelector('[aria-label="Open Salesforce workspace"]'))`, `${page} launcher`);
  }
  const peer = new BrowserWindow({
    show: true, width: 1400, height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"), contextIsolation: false, sandbox: false, nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ["--settings-only"]
    }
  });
  try {
    await peer.loadURL(win.webContents.getURL());
    async function waitForPeer(code, description) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await peer.webContents.executeJavaScript(code)) return;
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${description} in second window`);
    }
    await waitForPeer(`Boolean(document.querySelector('[aria-label="Open Salesforce workspace"]'))`, "launcher");
    await peer.webContents.executeJavaScript(`document.querySelector('[aria-label="Open Salesforce workspace"]').click(); true`);
    await waitForPeer(`document.querySelector('[data-salesforce-panel]').getAttribute("aria-hidden") === "false"`, "workspace launch");
    assert.equal(peer.contentView.children[0].webContents.id, pageId, "second window reuses the same Salesforce page");
    assert.equal(win.contentView.children.length, 0, "original window no longer owns the page");
    await evaluate(`location.hash="#/Settings"; true`);
    await waitFor(`Boolean(document.querySelector("#salesforce-launcher"))`, "launcher setting");
    await evaluate(`document.querySelector("#salesforce-launcher").click(); true`);
    await waitForPeer(`!document.querySelector('[aria-label="Open Salesforce workspace"]')`, "live hide preference");
    await evaluate(`document.querySelector("#salesforce-launcher").click(); true`);
    await waitForPeer(`Boolean(document.querySelector('[aria-label="Open Salesforce workspace"]'))`, "live show preference");
  } finally {
    peer.destroy();
  }
  console.log("ok   Salesforce drawer toggles, resizes, preserves its page and moves across EnQuote windows; settings persist.");
}

module.exports = {runSettings};
