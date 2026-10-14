const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runQuoteLinks(win) {
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function waitFor(code, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${description}: ${await evaluate("document.body.innerText.slice(-1500)")}`);
  }
  await evaluate(`(() => {
    const base = {quote_number:"Q-5240439513", site_id:"2397768", case_number:"19837621",
      status:"draft", created_date:"2026-10-01T00:00:00Z", updated_date:"2026-10-12T00:00:00Z",
      line_items:[], status_history:[], quote_requester:"smoke.test@enphaseenergy.com"};
    window.__smokePaidQuotes = [
      {...base,id:"old-version",is_current_version:false,version_number:1},
      {...base,id:"current-version",parent_quote_id:"old-version",is_current_version:true,version_number:2}
    ];
    location.hash="#/QuoteDetails?id=sender-old&quoteNumber=Q-5240439513";
  })()`);
  await waitFor(`location.hash.includes("id=current-version") &&
    Boolean(document.querySelector('[data-enquote-share-target="quote:current-version"]'))`, "automatic current-version resolution");
  assert.equal(await evaluate(`document.body.innerText.includes("Could not open quote")`), false);
  await evaluate(`(() => {
    window.__smokePaidQuotes.push({...window.__smokePaidQuotes[1],id:"conflicting-version",version_number:3});
    location.hash="#/QuoteDetails?id=sender-conflict&quoteNumber=Q-5240439513";
  })()`);
  await waitFor(`Boolean(document.querySelector('[aria-label="Matching quote records"]'))`, "matching version picker");
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Matching quote records"] li').length`), 2);
  await evaluate(`document.querySelector('[aria-label="Matching quote records"] a[href*="id=conflicting-version"]').click()`);
  await waitFor(`Boolean(document.querySelector('[data-enquote-share-target="quote:conflicting-version"]'))`, "chosen duplicate record opens");
  await evaluate(`location.hash="#/QuoteDetails?id=old-version&quoteNumber=Q-5240439513"`);
  await waitFor(`Boolean(document.querySelector('[data-enquote-share-target="quote:old-version"]'))`, "exact historical ID remains accessible");
  await evaluate(`(() => {
    Object.assign(window.__smokePaidQuotes[0], {picklist:"On-Demand",om_status:"Quote Missing Details",
      fst_count:1,labor_hours:1,travel_hours:1,miles_traveled:1,valid_until:"2026-12-31",scope_of_work:"Before update",
      items:[{product_id:"existing-part",name:"Existing part",description:"Existing part",quantity:1,unit_price:10,total:10}],
      created_by_id:"smoke-user",created_by:"smoke.test@enphaseenergy.com"});
    window.__smokeQuoteSaveDelay=1200;
    location.hash="#/EditQuote?id=old-version";
  })()`);
  await waitFor(`Boolean(document.querySelector('textarea#scope_of_work'))`, "edit form");
  await evaluate(`(() => {
    const field=document.querySelector('textarea#scope_of_work');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"Saved after navigation");
    field.dispatchEvent(new Event("input",{bubbles:true}));
  })()`);
  await waitFor(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==="Update Quote" && !button.disabled)`, "enabled update quote");
  await evaluate(`(() => {
    [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==="Update Quote").click();
    location.hash="#/Tasks";
  })()`);
  await waitFor(`window.__smokePaidQuotes[0].scope_of_work==="Saved after navigation"`, "save completes after editor closes");
  assert.equal(await evaluate(`location.hash`), "#/Tasks", "background save does not force navigation away from current screen");
  await evaluate(`location.hash="#/QuoteDetails?id=old-version"`);
  await waitFor(`document.body.innerText.includes("Saved after navigation")`, "reopened quote shows confirmed changes");
  await evaluate(`window.__smokeQuoteSaveDelay=0; true`);
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==="Submit for Approval").click()`);
  await waitFor(`window.__smokePaidQuotes[0].status==="submitted"`, "submission saved");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].items[0].product_id`), "existing-part", "submission retains saved items");
  await waitFor(`Boolean(document.querySelector('[aria-label="Quote actions"] [role="combobox"]')) &&
    document.querySelector('[aria-label="Quote actions"] [role="combobox"]').textContent.includes("Quote Pending Approval")`, "confirmed submission cache");
  await evaluate(`document.querySelector('[aria-label="Quote actions"] [role="combobox"]').click()`);
  await waitFor(`[...document.querySelectorAll('[role="option"]')].some(option=>option.textContent==="Quote Draft")`, "manual status menu");
  await evaluate(`[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==="Quote Draft").click()`);
  await waitFor(`window.__smokePaidQuotes[0].status==="draft_without_internal"`, "manual status saved");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].items[0].product_id`), "existing-part");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].scope_of_work`), "Saved after navigation");
  assert.equal(await evaluate(`(() => {
    const bar = document.querySelector('[aria-label="Quote actions"]');
    const order = [...bar.querySelectorAll('[role="combobox"], button')].map(node => node.getAttribute("role") === "combobox" ? "status" : node.textContent.trim());
    return order.indexOf("status") === 0 && order.indexOf("Submit / edit Panel RMA") > 0;
  })()`), true, "status dropdown comes before Submit / edit Panel RMA");
  console.log("ok   Quote saves: delayed persistence survives immediate navigation and reopening.");

  await evaluate(`location.hash="#/EditQuote?id=old-version"`);
  await waitFor(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==="Quote Draft Agent")`, "Quote Draft Agent button");
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==="Quote Draft Agent").click()`);
  await waitFor(`Boolean(document.querySelector('[role="dialog"] textarea'))`, "agent paste box");
  await evaluate(`(() => {
    const field=document.querySelector('[role="dialog"] textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,
      "O&M_QUOTE_REQUEST\\nSite Information\\nSite ID: 2397768\\nCase Number: 19837621\\nRecommended Scope of Work\\nScope Description: Replace one IQ8A microinverter on the existing IQ7 system and repair wiring.\\nLabor\\nEstimated Onsite Labor Hours: 2-3\\nProducts\\nItem Name: IQ8A\\nQuantity: 1\\nAdditional Materials\\nItem Name: Mystery widget\\nQuantity: 1");
    field.dispatchEvent(new Event("input",{bubbles:true}));
  })()`);
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.trim()==="Parse Output").click()`);
  await waitFor(`Boolean(document.querySelector('[data-agent-review] [data-agent-classification]'))`, "agent request classification");
  assert.ok(await evaluate(`Boolean(document.querySelector('[role="dialog"] [data-enphase-spec="iq8a"]'))`), "agent shows the IQ8A data sheet line");
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-agent-flags] [data-flag-status="spec_reference"]'))`), "agent shows the IQ8-with-IQ7 data sheet check");
  const agentItems = await evaluate(`document.querySelectorAll('[data-agent-item]').length`);
  await evaluate(`document.querySelector('[data-agent-add-item]').click()`);
  await waitFor(`[...document.querySelectorAll('[role="dialog"][data-state="open"]')].some(node=>node.innerText.includes("Add Item from Catalog"))`, "agent Add Item opens the catalog");
  await evaluate(`(() => {
    const input=[...document.querySelectorAll('[role="dialog"] input[placeholder="Search by name or SKU..."]')].pop();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"IQ8A");
    input.dispatchEvent(new Event("input",{bubbles:true}));
  })()`);
  await waitFor(`Boolean(document.querySelector('[data-catalog-result]'))`, "catalog results");
  await evaluate(`document.querySelector('[data-catalog-result]').click()`);
  await waitFor(`document.querySelectorAll('[data-agent-item]').length===${agentItems + 1}`, "agent Add Item appends a catalog line");
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-agent-review]'))`), "agent dialog stays open after the catalog picker closes");
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.trim()==="Apply to Quote").click()`);
  await waitFor(`!document.querySelector('[data-agent-review]')`, "agent applies and closes");
  console.log("ok   Quote Draft Agent: Auto-Drafter classification, data sheet checks and catalog Add Item; status dropdown before Panel RMA.");
  await evaluate(`(() => {
    window.__smokePaidQuotes = [{id:"invoice-quote", quote_number:"Q-INV1", case_number:"19645520", site_id:"3567740", picklist:"On-Demand",
      status:"ho_approved_invoice_required", total:250, created_date:"2026-10-01T00:00:00Z", updated_date:"2026-10-13T00:00:00Z",
      items:[], status_history:[], created_by:"smoke.test@enphaseenergy.com"}];
    location.hash = "#/QuoteDetails?id=invoice-quote"; return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('[data-mark-invoiced]'))`, "Mark as Invoiced button");
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-invoice-number]'))`), false, "No invoice row before invoicing");
  await evaluate(`document.querySelector('[data-mark-invoiced]').click()`);
  await waitFor(`Boolean(document.querySelector('[data-invoice-number-input]'))`, "invoice number dialog");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].status`), "ho_approved_invoice_required", "Opening the dialog does not change status");
  assert.equal(await evaluate(`document.querySelector('[data-invoice-number-submit]').disabled`), true, "Invoice number is required");
  const typeInvoice = (value) => evaluate(`(() => {
    const input=document.querySelector('[data-invoice-number-input]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event("input",{bubbles:true})); return true;
  })()`);
  await typeInvoice("  INV-1001 ");
  await evaluate(`document.querySelector('[data-invoice-number-submit]').click()`);
  await waitFor(`window.__smokePaidQuotes[0].status==="invoiced"`, "quote marked invoiced");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].invoice_number`), "INV-1001");
  await waitFor(`document.querySelector('[data-invoice-number]')?.textContent==="INV-1001"`, "invoice number shown in Quote Details");
  assert.ok(await evaluate(`(() => {
    const labels=[...document.querySelectorAll('p')].map(node=>node.textContent);
    return labels.indexOf("Case Number") < labels.indexOf("Invoice Number") && labels.indexOf("Invoice Number") < labels.indexOf("Project Picklist");
  })()`), "Invoice Number sits between Case Number and Project Picklist");
  await evaluate(`document.querySelector('[data-edit-invoice-number]').click()`);
  await waitFor(`document.querySelector('[data-invoice-number-input]')?.value==="INV-1001"`, "edit dialog prefilled");
  await typeInvoice("INV-1002");
  await evaluate(`document.querySelector('[data-invoice-number-submit]').click()`);
  await waitFor(`window.__smokePaidQuotes[0].invoice_number==="INV-1002"`, "invoice number edited");
  assert.equal(await evaluate(`window.__smokePaidQuotes[0].status`), "invoiced", "Editing keeps the status");
  assert.match(await evaluate(`window.__smokePaidQuotes[0].status_history.at(-1).reason`), /INV-1001 to INV-1002/);
  await evaluate(`(() => {
    window.__smokePaidQuotes.push({id:"other-quote", quote_number:"Q-OTHER", case_number:"555", site_id:"999", status:"draft", total:10,
      created_date:"2026-10-02T00:00:00Z", updated_date:"2026-10-13T00:00:00Z", items:[], status_history:[], created_by:"someone@else.com"},
      {id:"no-invoice-quote", quote_number:"Q-5522775396", case_number:"556", site_id:"2865235", status:"invoice_paid", total:1000,
      created_date:"2026-10-03T00:00:00Z", updated_date:"2026-10-13T00:00:00Z", items:[], created_by:"someone@else.com",
      status_history:[{status:"invoice_paid", changed_by:"someone@else.com", changed_at:"2026-09-01T00:00:00Z"}]});
    location.hash = "#/Quotes"; return true;
  })()`);
  await waitFor(`document.querySelector('[data-enquote-share-target="quote:invoice-quote"] [data-quote-card-invoice]')?.textContent.includes("INV-1002")`, "invoice number on the quote tile");
  console.log("ok   Mark as Invoiced requires an invoice number; it is shown after Case Number and editable like Paid At.");
  await waitFor(`document.querySelectorAll('[data-enquote-share-target^="quote:"][role]').length===3`, "quote tiles");
  assert.equal(await evaluate(`document.querySelector('[data-enquote-share-target="quote:invoice-quote"] [data-quote-card-invoice-number]')?.textContent`), "INV-1002", "Tile shows the invoice number");
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-enquote-share-target="quote:other-quote"] [data-quote-card-invoice]'))`), false, "Un-invoiced tiles have no invoice row");
  const placeholder = await evaluate(`(() => {
    const row=document.querySelector('[data-enquote-share-target="quote:no-invoice-quote"] [data-quote-card-invoice]');
    const label=row.querySelector('[data-quote-card-invoice-number]');
    const quoteNumber=row.parentElement.querySelector('p');
    return {text:label.textContent, height:row.getBoundingClientRect().height, fits:label.scrollWidth<=label.clientWidth,
      quoteNumberFits:quoteNumber.scrollWidth<=quoteNumber.clientWidth,
      alertRow:Boolean(document.querySelector('[data-enquote-share-target="quote:no-invoice-quote"] [data-quote-card-alerts]'))};
  })()`);
  assert.equal(placeholder.text, "Add invoice #");
  assert.ok(placeholder.alertRow, "Overdue alert renders on its own row");
  assert.ok(placeholder.height < 24 && placeholder.fits && placeholder.quoteNumberFits, `Header text is not squeezed by alerts: ${JSON.stringify(placeholder)}`);
  await evaluate(`document.querySelector('[data-enquote-share-target="quote:invoice-quote"] [data-quote-card-edit-invoice]').click()`);
  await waitFor(`document.querySelector('[data-invoice-number-input]')?.value==="INV-1002"`, "tile edit dialog prefilled");
  assert.match(await evaluate(`location.hash`), /Quotes/, "Pencil does not open the quote");
  await typeInvoice("INV-1003");
  await evaluate(`document.querySelector('[data-invoice-number-submit]').click()`);
  await waitFor(`window.__smokePaidQuotes[0].invoice_number==="INV-1003"`, "invoice number edited from the tile");
  await waitFor(`document.querySelector('[data-enquote-share-target="quote:invoice-quote"] [data-quote-card-invoice-number]')?.textContent==="INV-1003"`, "tile refreshes");
  assert.match(await evaluate(`location.hash`), /Quotes/, "Saving stays on the Quotes screen");
  const setSearch = (value) => evaluate(`(() => {
    const input=document.querySelector('input[placeholder^="Search by Site ID"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event("input",{bubbles:true})); return true;
  })()`);
  await setSearch("inv-1003");
  await waitFor(`document.querySelectorAll('[data-enquote-share-target^="quote:"][role]').length===1`, "search by invoice number");
  assert.match(await evaluate(`document.querySelector('[data-enquote-share-target^="quote:"][role]').getAttribute('aria-label')`), /Q-INV1/);
  await setSearch("");
  await evaluate(`document.querySelector('[data-enquote-share-target="quote:no-invoice-quote"] [data-quote-card-log]').click()`);
  await waitFor(`Boolean(document.querySelector('[role="dialog"] textarea'))`, "log follow-up dialog");
  assert.match(await evaluate(`location.hash`), /Quotes/, "Log icon does not open the quote");
  await evaluate(`(() => {
    const field=document.querySelector('[role="dialog"] textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(field,"Called HO, left voicemail");
    field.dispatchEvent(new Event("input",{bubbles:true})); return true;
  })()`);
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.trim()==="Log Follow-Up").click()`);
  await waitFor(`window.__smokePaidQuotes.find(q=>q.id==="no-invoice-quote").status_history.at(-1)?.entry_type==="follow_up"`, "follow-up saved from the tile");
  assert.equal(await evaluate(`window.__smokePaidQuotes.find(q=>q.id==="no-invoice-quote").status_history.at(-1).reason`), "Called HO, left voicemail");
  await waitFor(`!document.querySelector('[role="dialog"] textarea')`, "log dialog closes");
  assert.match(await evaluate(`location.hash`), /Quotes/, "Logging stays on the Quotes screen");
  console.log("ok   Quote tiles log follow-ups in place.");
  console.log("ok   Quote tiles show and edit the invoice number; quotes are searchable by invoice number.");
  console.log("ok   Quote links: current version recovery, explicit duplicate selection, and historical ID navigation.");
}

module.exports = {runQuoteLinks};
