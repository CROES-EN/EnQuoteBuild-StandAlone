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
  console.log("ok   Quote saves: delayed persistence survives immediate navigation and reopening.");
  console.log("ok   Quote links: current version recovery, explicit duplicate selection, and historical ID navigation.");
}

module.exports = {runQuoteLinks};
