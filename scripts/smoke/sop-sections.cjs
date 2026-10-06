const assert = require("node:assert/strict");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSopSections(win) {
  // Hidden Electron windows can leave Radix exit animations mounted indefinitely.
  await win.webContents.insertCSS("* { animation: none !important; transition: none !important; }");
  async function evaluate(code) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return {ok: true, value: await eval(${JSON.stringify(code)})}; }
      catch (error) { return {ok: false, error: error.message}; }
    })()`);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }
  async function click(selector) {
    const position = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing control: " + ${JSON.stringify(selector)});
      element.scrollIntoView({block: "nearest"});
      const rect = element.getBoundingClientRect();
      return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
    })()`);
    win.webContents.sendInputEvent({type: "mouseDown", ...position, button: "left", clickCount: 1});
    win.webContents.sendInputEvent({type: "mouseUp", ...position, button: "left", clickCount: 1});
    await sleep(250);
  }
  async function fill(selector, value) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", {bubbles: true}));
      return true;
    })()`);
    await sleep(100);
  }
  const nameSection = (title) => fill("#sop-section-name", title);
  async function clickText(text, selector = "button") {
    await evaluate(`(() => {
      const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!item) throw new Error("Missing action: " + ${JSON.stringify(text)});
      item.click();
      return true;
    })()`);
    await sleep(250);
  }
  async function submit() {
    await click('[role="dialog"] button[type="submit"]');
    await sleep(350);
  }
  async function records() {
    return evaluate("window.enquoteLocal.sops.list()");
  }

  await evaluate(`location.hash = "#/SOPLibrary"; true`);
  await sleep(700);
  await evaluate(`window.prompt = () => { throw new Error("Native prompts must not be used"); }; true`);
  await click('[aria-label="Add section"]');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`), true);
  await nameSection("   ");
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`), true);
  await click('[role="dialog"] form button[type="button"]');
  await sleep(250);
  assert.equal((await records()).filter((doc) => doc.kind === "section").length, 2);

  const title = "Field Operations and Preventive Maintenance";
  await click('[aria-label="Add section"]');
  await nameSection(`  ${title}  `);
  await submit();
  let sections = (await records()).filter((doc) => doc.kind === "section");
  assert.equal(sections.length, 3);
  const created = sections.find((doc) => doc.title === title);
  assert.ok(created);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem("enquote:sop-library-selection")).sectionId`), created.id);

  // Both navigation modes must open the same working dialog; duplicate names must not overwrite.
  await click('[aria-label="Collapse SOP navigation"]');
  await click('[aria-label="Add section"]');
  await nameSection(title);
  await submit();
  sections = (await records()).filter((doc) => doc.kind === "section");
  assert.equal(sections.length, 4);
  assert.equal(new Set(sections.map((doc) => doc.id)).size, 4);
  await click('[aria-label="Expand SOP navigation"]');

  await click(`[aria-label="Section actions for ${title}"]`);
  await clickText("Rename", '[role="menuitem"]');
  assert.equal(await evaluate(`document.querySelector("#sop-section-name").value`), title);
  const renamed = "Maintenance" + "x".repeat(110);
  await nameSection(renamed);
  await submit();
  assert.equal((await records()).find((doc) => doc.id === created.id).title, renamed);

  for (const [width, height] of [[1400, 900], [1024, 768], [760, 700]]) {
    win.setSize(width, height);
    await sleep(350);
    const layout = await evaluate(`(() => {
      const button = document.querySelector('[aria-label="Open SOP section ${renamed}"]');
      const label = button.querySelector("span:last-child");
      const style = getComputedStyle(label);
      return {text: label.textContent, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
        clipped: label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        bellOverlap: (() => {
          const page = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "New page").getBoundingClientRect();
          const bell = document.querySelector('[title="Notifications"]').getBoundingClientRect();
          return page.left < bell.right && page.right > bell.left && page.top < bell.bottom && page.bottom > bell.top;
        })()};
    })()`);
    assert.equal(layout.text, renamed);
    assert.notEqual(layout.whiteSpace, "nowrap");
    assert.notEqual(layout.textOverflow, "ellipsis");
    assert.equal(layout.clipped, false, `Full section name visible at ${width}px`);
    assert.equal(layout.horizontalOverflow, false, `No horizontal overflow at ${width}px`);
    assert.equal(layout.bellOverlap, false, `New page clears notification bell at ${width}px`);
  }

  await click('[aria-label="Add section"]');
  await nameSection("Retry section");
  await evaluate(`window.__smokeSopSaveError = "Could not save test section"; true`);
  await submit();
  assert.equal(await evaluate(`document.querySelector("#sop-section-name").value`), "Retry section");
  assert.equal((await records()).some((doc) => doc.title === "Retry section"), false);
  assert.equal(await evaluate(`document.body.innerText.includes("Could not save test section")`), true);
  await evaluate(`window.__smokeSopSaveError = ""; true`);
  await submit();
  assert.ok((await records()).some((doc) => doc.title === "Retry section"));
  await evaluate(`location.hash = "#/Dashboard"; true`);
  await sleep(500);
  await evaluate(`location.hash = "#/SOPLibrary"; true`);
  await sleep(700);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP section Retry section"]') !== null`), true);

  win.setSize(1400, 900);
  await sleep(250);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Switch workbook"]') === null`), true, "No separate workbook level");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP section O&M Marketplace"]') !== null`), true, "Legacy workbook sections are top-level sections");
  await click('[aria-label="Add section"]');
  await nameSection("Workbook Section");
  await submit();
  const workbookSection = (await records()).find((doc) => doc.title === "Workbook Section");
  assert.ok(workbookSection);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP section General"]') !== null`), true);
  await clickText("New page");
  await fill("#sop-title", "Workbook page");
  await clickText("Save");
  await sleep(350);
  const page = (await records()).find((doc) => doc.title === "Workbook page");
  assert.ok(page.id);
  assert.equal(page.section_id, workbookSection.id);

  await click('[aria-label="Page actions for Workbook page"]');
  await clickText("Add sub-page", '[role="menuitem"]');
  await fill("#sop-title", "Workbook subpage");
  await clickText("Save");
  await sleep(350);
  const subpage = (await records()).find((doc) => doc.title === "Workbook subpage");
  assert.equal(subpage.parent_id, page.id);
  assert.equal(subpage.section_id, workbookSection.id);
  await click('[aria-label="Collapse subpages for Workbook page"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') === null`), true);
  await click('[aria-label="Expand subpages for Workbook page"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') !== null`), true);

  await click('[aria-label="Section actions for Workbook Section"]');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes("workbook"))`), false, "No workbook actions");
  await clickText("Edit section", '[role="menuitem"]');
  assert.equal(await evaluate(`document.querySelector("#sop-section-workbook") === null`), true, "Section editor has no workbook selector");
  await clickText("Cancel", '[role="dialog"] button');
  await click('[aria-label="Open SOP section General"]');
  await fill('[placeholder="Search all SOP pages"]', "Workbook subpage");
  await click('[aria-label="Open SOP page Workbook subpage"]');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem("enquote:sop-library-selection")).sectionId`), workbookSection.id);
  await fill('[placeholder="Search all SOP pages"]', "");
  await evaluate(`location.hash = "#/Dashboard"; true`);
  await sleep(350);
  await evaluate(`location.hash = "#/SOPLibrary"; true`);
  await sleep(700);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP section Workbook Section"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') === null`), true, "Groups collapsed when opening SOP Library");

  await evaluate(`window.enquoteLocal.sops.save({id: "stability-child", title: "Existing stability subpage", section_id: "smoke-section", parent_id: "smoke-page"})`);
  await evaluate(`window.enquoteLocal.sops.save({id: "standalone-leaf", title: "Standalone leaf", section_id: "smoke-section"})`);
  await click('[aria-label="Open SOP section Workbook Section"]');
  await click('[aria-label="Open SOP page Workbook page"]');
  await clickText("Edit");
  await click("#sop-parent");
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="option"]')].some((option) => option.textContent.includes("Workbook subpage"))`), false, "Cannot choose a descendant as parent");
  await clickText("Top-level page (no parent)", '[role="option"]');
  await click("#sop-section");
  await clickText("General", '[role="option"]');
  await click("#sop-parent");
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="option"]')].some((option) => option.textContent.includes("Standalone leaf"))`), false, "Editor excludes pages without subpages");
  await clickText("Stability SOP", '[role="option"]');
  await clickText("Cancel");
  assert.equal((await records()).find((doc) => doc.id === page.id).section_id, workbookSection.id);

  await clickText("Edit");
  await click("#sop-section");
  await clickText("General", '[role="option"]');
  await click("#sop-parent");
  await clickText("Stability SOP", '[role="option"]');
  await clickText("Save");
  await sleep(350);
  const nested = (await records()).find((doc) => doc.id === page.id);
  const nestedChild = (await records()).find((doc) => doc.id === subpage.id);
  assert.equal(nested.section_id, "smoke-section");
  assert.equal(nested.parent_id, "smoke-page");
  assert.equal(nestedChild.section_id, "smoke-section");
  assert.equal(nestedChild.parent_id, page.id);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook page"]') !== null`), true, "Moved page path revealed");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') === null`), true, "Moved page children stay collapsed");
  await click('[aria-label="Expand subpages for Workbook page"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') !== null`), true);
  await click('[aria-label="Collapse subpages for Stability SOP"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Workbook subpage"]') === null`), true);
  await click('[aria-label="Expand subpages for Stability SOP"]');
  await clickText("Edit");
  await click("#sop-parent");
  await clickText("Top-level page (no parent)", '[role="option"]');
  await clickText("Save");
  await sleep(350);
  assert.equal((await records()).find((doc) => doc.id === page.id).parent_id, null);
  assert.equal((await records()).find((doc) => doc.id === subpage.id).parent_id, page.id);
  await evaluate(`location.hash = "#/Dashboard"; true`);
  await sleep(350);
  await evaluate(`location.hash = "#/SOPLibrary"; true`);
  await sleep(700);
  await click('[aria-label="Open SOP page Workbook page"]');
  await clickText("Edit");
  assert.equal(await evaluate(`document.querySelector("#sop-parent").textContent`), "Top-level page (no parent)");
  await clickText("Cancel");

  await click('[aria-label="Open SOP section General"]');
  await click('[aria-label="Page actions for Workbook page"]');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent === "Move to section")`), false);
  await clickText("Move to parent page", '[role="menuitem"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Move under Standalone leaf"]') === null`), true, "Move menu excludes pages without subpages");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Move under Workbook page"]') === null`), true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Move under Workbook subpage"]') === null`), true);
  await click('[aria-label="Move under Stability SOP"]');
  assert.equal((await records()).find((doc) => doc.id === page.id).parent_id, "smoke-page");
  assert.equal((await records()).find((doc) => doc.id === subpage.id).parent_id, page.id);
  await click('[aria-label="Page actions for Workbook page"]');
  await clickText("Move to parent page", '[role="menuitem"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Move under Stability SOP"]').getAttribute("aria-disabled")`), "true");
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); true`);
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); true`);
  await sleep(250);
  await click('[aria-label="Import OneNote section"]');
  assert.equal(await evaluate(`document.querySelector("#onenote-section").textContent`), "General");
  assert.equal(await evaluate(`document.querySelector("#onenote-workbook") === null`), true, "No workbook destination");
  assert.equal(await evaluate(`document.querySelector("#onenote-section").disabled`), false, "Destination section selectable before import");
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === "Import section").disabled`), true);
  await clickText("Cancel", '[role="dialog"] button');
  assert.equal((await records()).some((doc) => doc.id === "smoke-imported-section"), false);
  await click('[aria-label="Import OneNote section"]');
  await click("#onenote-section");
  await clickText("O&M Marketplace", '[role="option"]');
  assert.equal(await evaluate(`document.querySelector("#onenote-section").textContent`), "O&M Marketplace");
  await click("#onenote-section");
  await clickText("Retry section", '[role="option"]');
  const destinationSectionId = (await records()).find((doc) => doc.kind === "section" && doc.title === "Retry section").id;
  await click("#onenote-accept");
  await evaluate(`window.__smokeOneNoteError = true; true`);
  await clickText("Import section", '[role="dialog"] button');
  assert.equal(await evaluate(`document.querySelector("#onenote-section").disabled`), true);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] [role="alert"]').textContent.includes("Retry")`), true);
  await evaluate(`window.__smokeOneNoteError = false; true`);
  await clickText("Retry import", '[role="dialog"] button');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem("enquote:sop-library-selection")).pageId`), "smoke-import-parent");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page OneNote imported section"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Imported parent"]') === null`), true);
  await click('[aria-label="Expand subpages for OneNote imported section"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Imported parent"]') !== null`), true);
  await click('[aria-label="Open SOP section General"]');
  await click('[aria-label="Open SOP section Retry section"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Imported parent"]') === null`), true);
  await click('[aria-label="Expand subpages for OneNote imported section"]');
  await evaluate(`location.hash = "#/Dashboard"; true`);
  await sleep(350);
  await evaluate(`location.hash = "#/SOPLibrary"; true`);
  await sleep(700);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Imported parent"]') === null`), true);
  assert.equal((await records()).filter((doc) => doc.id === "smoke-imported-section").length, 0);
  assert.equal((await records()).find((doc) => doc.id === "smoke-import-parent").section_id, destinationSectionId);
  assert.equal((await records()).find((doc) => doc.id === "smoke-imported-page").parent_id, "smoke-import-parent");

  await evaluate(`window.__smokeOneNoteMulti = true; window.__smokeImportCalls = []; true`);
  await click('[aria-label="Import OneNote section"]');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] h2').textContent`), "Import OneNote sections");
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="OneNote sections to import"] li').length`), 2);
  await click("#onenote-section");
  await clickText("O&M Marketplace", '[role="option"]');
  await click("#onenote-accept");
  await clickText("Import 2 sections", '[role="dialog"] button');
  await sleep(350);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true);
  assert.deepEqual(await evaluate(`window.__smokeImportCalls.map((call) => call.sessionId + ":" + call.sectionId)`),
    ["smoke-onenote-import:smoke-legacy-section", "smoke-onenote-import-2:smoke-legacy-section"], "Each file imported once, in order, into the chosen section");
  const marketplaceParents = (await records()).filter((doc) => doc.section_id === "smoke-legacy-section" && !doc.parent_id).map((doc) => doc.title);
  assert.deepEqual(marketplaceParents, ["OneNote imported section", "Second OneNote section"]);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Open SOP page Second OneNote section"]') !== null`), true);
  await evaluate(`window.__smokeOneNoteMulti = false; true`);
  assert.deepEqual(await evaluate("window.__smokeErrors"), []);
  console.log("ok   SOP Library: top-level sections (no workbook level)/pages/subpages, editor moves with descendants, promotion/cancel/cycle prevention, rename/move/search, collapsed navigation, full labels, bell clearance, save failure/retry and reload");
}

module.exports = {runSopSections};
