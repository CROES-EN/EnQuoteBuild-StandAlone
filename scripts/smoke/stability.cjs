const assert = require("node:assert/strict");
const {app} = require("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runStability(win) {
  async function evaluate(code) {
    const result = await win.webContents.executeJavaScript(`(() => {
      try {
        const value = ${code};
        return {ok: true, value};
      } catch (error) {
        return {ok: false, error: error.stack || error.message};
      }
    })()`);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }
  async function clickPosition(position) {
    win.webContents.sendInputEvent({type: "mouseDown", ...position, button: "left", clickCount: 1});
    win.webContents.sendInputEvent({type: "mouseUp", ...position, button: "left", clickCount: 1});
    await sleep(250);
  }
  async function navigate(page) {
    await evaluate(`location.hash = ${JSON.stringify(`#/${page}`)}; true`);
    await sleep(700);
  }
  async function click(selector) {
    const position = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing control: " + ${JSON.stringify(selector)});
      element.scrollIntoView({block: "nearest"});
      const rect = element.getBoundingClientRect();
      return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
    })()`);
    await clickPosition(position);
  }
  async function openThemes() {
    const position = await evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((item) =>
        item.getBoundingClientRect().width > 0 && (item.textContent.trim() === "Theme" || item.getAttribute("aria-label") === "Change color theme"));
      if (!button) throw new Error("Theme switcher is missing. Rendered screen: " + document.body.innerText.slice(0, 1200) + " Bridge calls: " + JSON.stringify(window.__smokeCalls));
      button.scrollIntoView({block: "nearest"});
      const rect = button.getBoundingClientRect();
      return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
    })()`);
    await clickPosition(position);
  }
  async function pickTheme(name) {
    await evaluate(`(() => {
      const button = [...document.querySelectorAll("button[aria-pressed]")].find((item) =>
        [...item.querySelectorAll("span")].some((span) => span.textContent === ${JSON.stringify(name)}));
      if (!button) throw new Error("Theme card is missing: " + ${JSON.stringify(name)});
      button.click();
      return true;
    })()`);
    await sleep(250);
  }
  async function closeThemes() {
    win.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
    win.webContents.sendInputEvent({type: "keyUp", keyCode: "Escape"});
    await sleep(400);
    assert.equal(await evaluate(`document.querySelector('[role="menu"][data-state="open"]') === null`), true, "Theme picker closes");
  }

  await navigate("Dashboard");
  await openThemes();
  const initial = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--background")`);
  await pickTheme("Monokai");
  assert.equal(await evaluate(`document.documentElement.dataset.theme`), "monokai");
  assert.notEqual(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--background")`), initial);
  await click('[aria-label="Match Windows light/dark mode"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Match Windows light/dark mode"]').getAttribute("aria-checked")`), "true");
  // Editing the choice for the current Windows mode must refresh even though themeId stays "system".
  await evaluate(`(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const select = document.querySelectorAll('[role="menu"] select')[dark ? 1 : 0];
    if (!select) throw new Error("Windows theme choice is missing");
    select.value = dark ? "solarized-dark" : "rose-gold";
    select.dispatchEvent(new Event("change", {bubbles: true}));
    return true;
  })()`);
  await sleep(250);
  assert.equal(await evaluate(`document.documentElement.dataset.theme`),
    await evaluate(`matchMedia("(prefers-color-scheme: dark)").matches ? "solarized-dark" : "rose-gold"`));
  await pickTheme("Light+ (Default)");
  assert.equal(await evaluate(`document.documentElement.dataset.theme`), "light-plus");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Match Windows light/dark mode"]').getAttribute("aria-checked")`), "false");
  await closeThemes();
  console.log("ok   Themes: cards apply immediately, Windows choices refresh, manual choice disables matching");

  await navigate("Users");
  const callsBefore = await evaluate(`window.__smokeCalls["admin.overview"] || 0`);
  assert.equal(await evaluate(`document.querySelector('[aria-controls="admin-menu-content"]').getAttribute("aria-expanded")`), "false");
  await sleep(300);
  assert.equal(await evaluate(`window.__smokeCalls["admin.overview"] || 0`), callsBefore);
  await click('[aria-controls="admin-menu-content"]');
  assert.equal(await evaluate(`document.querySelector('[aria-controls="admin-menu-content"]').getAttribute("aria-expanded")`), "true");
  assert.equal(await evaluate(`window.__smokeCalls["admin.overview"] || 0`), callsBefore + 1);
  await click('[aria-controls="admin-menu-content"]');
  assert.equal(await evaluate(`document.getElementById("admin-menu-content") === null`), true);
  console.log("ok   Admin Menu: collapsed by default, lazy requests, unmounted on collapse");

  await navigate("SOPLibrary");
  await click('[aria-label="Open SOP page Stability SOP"]');
  for (const [width, height] of [[1400, 900], [1024, 768], [760, 700]]) {
    win.setSize(width, height);
    await sleep(400);
    const layout = await evaluate(`(() => {
      const workspace = document.querySelector('[data-testid="sop-workspace"]').getBoundingClientRect();
      const detail = document.querySelector('[data-testid="sop-detail"]').getBoundingClientRect();
      return {bottom: workspace.bottom, right: workspace.right, detailBottom: detail.bottom, bodyMarginRight: getComputedStyle(document.body).marginRight, scrollLocked: document.body.getAttribute("data-scroll-locked"),
        width: document.documentElement.clientWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1};
    })()`);
    assert.ok(Math.abs(layout.bottom - layout.height) <= 2, `SOP workspace fills height at ${width}px`);
    assert.ok(Math.abs(layout.right - layout.width) <= 2, `SOP workspace fills width at ${width}px: ${JSON.stringify(layout)}`);
    assert.ok(layout.detailBottom <= layout.height, "SOP detail fits viewport");
    assert.equal(layout.horizontalOverflow, false, "No horizontal overflow");
    await click('[aria-label="Collapse SOP navigation"]');
    await click('[aria-label="Expand SOP navigation"]');
  }
  console.log("ok   SOP Library: fills available space at desktop/tablet/mobile widths, navigation collapses");
  win.setSize(1400, 900);
  await navigate("Messages?c=smoke-chat");
  const bubbleBefore = await evaluate(`getComputedStyle(document.querySelector('[data-testid="chat-bubble-mine"]')).backgroundColor`);
  await openThemes();
  await pickTheme("Monokai");
  await closeThemes();
  const chatColors = await evaluate(`(() => {
    const style = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    function token(name) {
      probe.style.backgroundColor = "hsl(" + style.getPropertyValue(name) + ")";
      return getComputedStyle(probe).backgroundColor;
    }
    const result = {
      mine: getComputedStyle(document.querySelector('[data-testid="chat-bubble-mine"]')).backgroundColor,
      mineExpected: token("--primary"),
      theirs: getComputedStyle(document.querySelector('[data-testid="chat-bubble-theirs"]')).backgroundColor,
      theirsExpected: token("--muted"),
      background: getComputedStyle(document.querySelector('[data-testid="chat-background"]')).backgroundColor,
      backgroundExpected: token("--background")
    };
    probe.remove();
    return result;
  })()`);
  assert.notEqual(chatColors.mine, bubbleBefore);
  assert.equal(chatColors.mine, chatColors.mineExpected);
  assert.equal(chatColors.theirs, chatColors.theirsExpected);
  assert.equal(chatColors.background, chatColors.backgroundExpected);
  console.log("ok   Chat: sent/received bubbles and background update with the app theme");
  await navigate("Dashboard");
  await evaluate(`document.querySelector('button[title="Change profile picture"]').click()`);
  await sleep(250);
  const gif = Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  await evaluate(`(() => {
    const input = document.querySelector('input[type="file"][accept*="image/gif"]');
    if (!input) throw new Error("GIF profile picker is missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(${JSON.stringify(gif)})], "animated.GIF", {type: "image/gif"}));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", {bubbles: true}));
    return true;
  })()`);
  await sleep(250);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "Upload");
    if (!button || button.disabled) throw new Error("Avatar upload is unavailable");
    button.click();
    return true;
  })()`);
  await sleep(300);
  assert.deepEqual(await evaluate(`window.__smokeUploadedAvatar`), {type: "image/gif", bytes: gif});
  console.log("ok   GIF profile picker: accepts GIFs and uploads original bytes without flattening");
  await navigate("Dashboard");
  await navigate("SOPLibrary");
  const samples = [];
  win.webContents.debugger.attach("1.3");
  try {
    await win.webContents.debugger.sendCommand("Performance.enable");
    for (let cycle = 0; cycle < 6; cycle++) {
      for (const page of ["Users", "Messages", "SOPLibrary", "Dashboard"]) await navigate(page);
      const state = await evaluate(`({errors: window.__smokeErrors.slice(), crashed: /Something went wrong/i.test(document.body.innerText)})`);
      assert.deepEqual(state.errors, [], `No uncaught errors in navigation cycle ${cycle + 1}`);
      assert.equal(state.crashed, false);
      const {metrics} = await win.webContents.debugger.sendCommand("Performance.getMetrics");
      samples.push(metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value);
    }
  } finally {
    win.webContents.debugger.detach();
  }
  app.getAppMetrics();
  await sleep(5000);
  const metrics = app.getAppMetrics().map(({type, cpu, memory}) => ({
    type, cpuPercent: Number(cpu.percentCPUUsage.toFixed(2)),
    workingSetMB: Number((memory.workingSetSize / 1024).toFixed(1))
  }));
  console.log("ok   Stability: 24 repeated page transitions without uncaught errors");
  console.log(`JS heap samples (MB, before GC): ${samples.map((bytes) => bytes ? (bytes / 1048576).toFixed(1) : "unavailable").join(", ")}`);
  console.log(`Idle process metrics (test fixtures, not a production benchmark): ${JSON.stringify(metrics)}`);
}

module.exports = {runStability};
