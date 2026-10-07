const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runDeveloperConsole(win) {
  win.showInactive();
  const evaluate = code => win.webContents.executeJavaScript(code);
  for (const width of [1440, 800, 400]) {
    win.setContentSize(width, 900);
    await sleep(500);
    const position = await evaluate(`(() => {
      const bell = document.querySelector('button[title="Notifications"]').getBoundingClientRect();
      const task = document.querySelector('button[aria-label="New task"]').getBoundingClientRect();
      return {bellRight: bell.right, taskRight: task.right, gap: task.top - bell.bottom,
        taskLeft: task.left, viewport: innerWidth};
    })()`);
    assert.equal(position.taskRight, position.bellRight, "task button aligns with the notification bell");
    assert.equal(position.gap, 8, "task button sits directly below the bell without overlap");
    assert.ok(position.taskLeft >= 0 && position.taskRight <= position.viewport, "task button fits the viewport");
  }
  await evaluate('document.querySelector(\'button[aria-label="New task"]\').click(); true');
  await sleep(300);
  assert.equal(await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog.textContent.includes("New task") && !!dialog.querySelector("#task-title") &&
      !!dialog.querySelector("#task-site-id") && !!dialog.querySelector("#task-case-number");
  })()`), true, "global shortcut opens the task form including site and case fields");
  for (const [width, height] of [[1440, 900], [800, 900], [400, 600]]) {
    win.setContentSize(width, height);
    await sleep(600);
    const bounds = await evaluate(`(() => {
      const panel = document.querySelector('[role="dialog"]');
      const rect = panel.getBoundingClientRect();
      return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height, viewport: document.documentElement.clientWidth, viewportHeight: innerHeight,
        modal: panel.getAttribute("aria-modal"), pointer: getComputedStyle(document.body).pointerEvents};
    })()`);
    assert.equal(bounds.top, 16, "panel sits in the top corner");
    assert.equal(bounds.right, bounds.viewport - 16, "panel sits in the right corner");
    assert.ok(bounds.width <= 420 && bounds.left >= 16, "compact panel stays within 420px and viewport");
    assert.ok(bounds.bottom <= bounds.viewportHeight - 16 + 1, "short windows scroll inside the panel");
    if (height === 900) assert.ok(bounds.height < height - 64, "panel is compact rather than full-height");
    assert.notEqual(bounds.modal, "true", "task panel is non-modal");
    assert.notEqual(bounds.pointer, "none", "underlying EnQuote remains interactive");
  }
  win.setContentSize(1440, 900);
  await sleep(400);
  await evaluate(`(() => {
    const input = document.getElementById("task-title");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Read while drafting");
    input.dispatchEvent(new Event("input", {bubbles: true}));
    return true;
  })()`);
  const outside = await evaluate(`(() => {
    const link = document.querySelector('a[href="#/Products"]');
    const rect = link.getBoundingClientRect();
    return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
  })()`);
  win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...outside});
  win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...outside});
  await sleep(500);
  assert.equal(await evaluate('location.hash'), "#/Products", "navigate EnQuote while the task panel remains open");
  assert.equal(await evaluate('document.getElementById("task-title")?.value'), "Read while drafting", "outside navigation preserves the draft");
  await evaluate(`(() => {
    const select = document.getElementById("task-recipient");
    select.value = "teammate@example.invalid";
    select.dispatchEvent(new Event("change", {bubbles: true}));
    for (const [id, value] of [["task-site-id", "00123"], ["task-case-number", "000456"]]) {
      const input = document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", {bubbles: true}));
    }
    window.__smokeTaskSendFail = true;
    return true;
  })()`);
  await sleep(200);
  await evaluate('[...document.querySelectorAll(\'[role="dialog"] button\')].find(button => button.textContent === "Send task").click(); true');
  await sleep(600);
  assert.equal(await evaluate('document.querySelector(\'[role="dialog"] fieldset\').disabled'), true, "uncertain sends lock assignment fields");
  assert.equal(await evaluate('!!document.querySelector(\'[role="dialog"] [role="alert"]\')'), true, "failed sends show an explicit error");
  await evaluate('window.__smokeTaskSendFail = false; [...document.querySelectorAll(\'[role="dialog"] button\')].find(button => button.textContent === "Retry assignment").click(); true');
  await sleep(600);
  const requests = await evaluate('window.__smokeTaskRequests');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].clientId, requests[1].clientId, "retry reuses assignment ID");
  assert.equal(requests[1].attachments[0].version, 2);
  assert.equal(requests[1].attachments[0].task.site_id, "00123");
  assert.equal(requests[1].attachments[0].task.case_number, "000456");
  assert.equal(await evaluate('!!document.querySelector(\'[role="dialog"]\')'), false, "confirmed assignment closes panel");
  await evaluate('document.querySelector(\'button[aria-label="New task"]\').click(); true');
  await sleep(300);
  assert.equal(await evaluate('document.getElementById("task-title").value'), "", "next task starts with a fresh draft");
  await evaluate('document.getElementById("task-title").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true})); true');
  await sleep(300);
  assert.equal(await evaluate('!!document.querySelector(\'[role="dialog"]\')'), false, "task dialog closes normally");
  console.log("ok New task panel: compact responsive corner, non-blocking navigation, full-field assignment and safe retry");
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {code: "Backquote", shiftKey: true})); true');
  await sleep(1000);
  for (const width of [1440, 800, 400]) {
    win.setContentSize(width, 900);
    await sleep(500);
    const sizes = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const nav = dialog.querySelector('[aria-label="Developer Console tabs"]');
      const rect = dialog.getBoundingClientRect();
      const tabs = [...nav.querySelectorAll("button")].map(button => button.getBoundingClientRect().top);
      const refresh = dialog.querySelector('button[title="Refresh"]').getBoundingClientRect();
      return {
        width: rect.width, left: rect.left, right: rect.right, viewport: innerWidth,
        tabCount: tabs.length, tops: tabs, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
        refreshRight: refresh.right
      };
    })()`);
    assert.equal(sizes.tabCount, 7, "all Super Admin tabs render");
    assert.ok(sizes.tops.every(top => Math.abs(top - sizes.tops[0]) < 1), "tabs stay on one row");
    assert.ok(sizes.left >= 0 && sizes.right <= sizes.viewport + 1, `dialog fits the viewport: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.refreshRight <= sizes.right, "actions stay visible outside the scrolling strip");
    if (width === 1440) {
      assert.ok(sizes.width > 1200, "console is wider than the previous 768px limit");
      assert.ok(sizes.scrollWidth <= sizes.clientWidth + 1, "all seven tabs fit without horizontal scrolling");
    } else {
      assert.ok(sizes.scrollWidth > sizes.clientWidth, "small windows scroll tabs rather than wrapping");
      assert.equal(await evaluate(`(() => {
        const nav = document.querySelector('[aria-label="Developer Console tabs"]');
        nav.scrollLeft = nav.scrollWidth;
        return nav.scrollLeft > 0;
      })()`), true);
    }
    console.log(`ok Developer Console at ${width}px: seven single-row tabs, ${sizes.width}px dialog`);
  }
  await evaluate(`(() => {
    const nav = document.querySelector('[aria-label="Developer Console tabs"]');
    [...nav.querySelectorAll("button")].find(button => button.textContent === "View user access").click();
    return true;
  })()`);
  await sleep(700);
  await evaluate(`(() => {
    const trigger = document.getElementById("access-preview-user");
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", code: "ArrowDown", bubbles: true}));
    return true;
  })()`);
  await sleep(300);
  await evaluate('document.querySelector(\'[role="option"]\').click(); true');
  await sleep(500);
  const unavailable = await evaluate(`(() => {
    const start = [...document.querySelectorAll("button")].find(button => button.textContent === "Start read-only viewing mode");
    return {disabled: start.disabled, message: document.body.innerText.includes("fully quit EnQuote")};
  })()`);
  assert.deepEqual(unavailable, {disabled: true, message: true}, "stale main process disables Start with restart guidance");
  assert.equal(await evaluate(`document.body.innerText.includes("Exit preview - return to my account") ||
    document.body.innerText.includes("Refresh preview data")`), false, "redundant preview buttons are removed");
  const overviewCalls = await evaluate('window.__smokeCalls["admin.overview"]');
  await evaluate(`window.__smokeViewingReady = true;
    document.querySelector('[role="dialog"] button[title="Refresh"]').click(); true`);
  await sleep(700);
  assert.ok(await evaluate('window.__smokeCalls["admin.overview"]') > overviewCalls, "console refresh reloads the service account list");
  assert.equal(await evaluate(`(() => {
    const start = [...document.querySelectorAll("button")].find(button => button.textContent === "Start read-only viewing mode");
    return start.disabled;
  })()`), false, "refresh confirms the main process is ready before enabling Start");
  console.log("ok Developer Console native availability: stale handler disabled, refreshed ready service enabled");
}

module.exports = {runDeveloperConsole};
