const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runChatComposer(win) {
  win.showInactive();
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function waitFor(code, label) {
    for (let count = 0; count < 150; count++) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const field = 'document.querySelector(\'[role="textbox"][aria-label="Message text"]\')';
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
  await evaluate(`location.hash="#/Messages?c=smoke-chat"; true`);
  await waitFor(`Boolean(${field})`, "message composer");
  await evaluate(`${field}.focus(); true`);
  await win.webContents.insertText("Pray for me");
  await evaluate(`(() => {
    const field = ${field}, range = document.createRange();
    range.setStart(field.firstChild, 5); range.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    field.dispatchEvent(new MouseEvent("mouseup", {bubbles:true}));
  })()`);
  await click('[aria-label="Add emoji or GIF"]');
  await waitFor(`Boolean(document.querySelector('[aria-label="Use pepe-pray"]'))`, "custom emoji picker");
  await click('[aria-label="Use pepe-pray"]');
  await waitFor(`${field}.querySelector('img')?.complete`, "inline emoji image");
  const token = `<:pepe-pray:${"c".repeat(64)}>`;
  assert.equal(await evaluate(`${field}.querySelector('[data-emoji-token]').dataset.emojiToken`), token);
  assert.equal(await evaluate(`${field}.textContent`), "Pray for me", "custom image is inline, not a chip");
  await evaluate(`document.execCommand("undo"); true`);
  assert.equal(await evaluate(`${field}.querySelectorAll('[data-emoji-token]').length`), 0, "undo removes emoji");
  await evaluate(`document.execCommand("redo"); true`);
  assert.equal(await evaluate(`${field}.querySelectorAll('[data-emoji-token]').length`), 1, "redo restores emoji");
  await click('[aria-label="Send"]');
  await waitFor(`window.__smokeTaskRequests?.some(item => item.body === ${JSON.stringify(`Pray ${token}for me`)})`, "inline emoji payload");
  const sent = await evaluate(`window.__smokeTaskRequests.at(-1)`);
  assert.deepEqual(sent.attachments, [], "emoji is not an attachment");
  await waitFor(`Boolean(document.querySelector('[data-testid="chat-bubble-mine"] img[alt=":pepe-pray:"]'))`, "sent inline emoji");
  assert.equal(await evaluate(`${field}.textContent`), "", "send clears composer");
  await evaluate(`${field}.focus(); true`);
  await win.webContents.insertText("Hello ");
  await click('[aria-label="Add emoji or GIF"]');
  await waitFor(`Boolean(document.querySelector('[aria-label="Use Like"]'))`, "builtin emoji picker");
  await click('[aria-label="Use Like"]');
  assert.equal(await evaluate(`${field}.textContent`), "Hello \uD83D\uDC4D");
  await evaluate(`(() => {
    const field = ${field};
    field.focus();
    const data = new DataTransfer();
    data.setData("text/plain", "<b>plain</b>");
    data.setData("text/html", "<b>rich</b>");
    field.dispatchEvent(new ClipboardEvent("paste", {clipboardData:data, bubbles:true, cancelable:true}));
  })()`);
  assert.equal(await evaluate(`${field}.querySelectorAll("b").length`), 0, "paste never inserts HTML");
  assert.equal(await evaluate(`${field}.textContent`), "Hello \uD83D\uDC4D<b>plain</b>");
  await evaluate(`${field}.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",shiftKey:true,bubbles:true,cancelable:true})); true`);
  await win.webContents.insertText("Next line");
  await click('[aria-label="Send"]');
  await waitFor(`window.__smokeTaskRequests.at(-1)?.body.includes("Next line")`, "multiline send");
  assert.equal(await evaluate(`window.__smokeTaskRequests.at(-1).body`), "Hello \uD83D\uDC4D<b>plain</b>\nNext line");

  await evaluate(`location.hash="#/Dashboard"; true`);
  await waitFor(`Boolean(${field} || document.querySelector('[aria-label^="Open chat with "]'))`, "chat dock");
  await evaluate(`document.querySelector('[aria-label^="Open chat with "]')?.click(); true`);
  await waitFor(`Boolean(${field})`, "dock composer");
  await evaluate(`${field}.focus(); true`);
  await win.webContents.insertText("Dock ");
  await click('[aria-label="Add emoji or GIF"]');
  await waitFor(`Boolean(document.querySelector('[aria-label="Use pepe-pray"]'))`, "dock emoji picker");
  await click('[aria-label="Use pepe-pray"]');
  await waitFor(`${field}.querySelector('img')?.complete`, "dock inline image");
  await evaluate(`(() => {
    const field = ${field};
    const range = document.createRange(); range.selectNodeContents(field);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const data = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent("copy", {clipboardData:data,bubbles:true,cancelable:true}));
    window.__smokeCopiedDraft = data.getData("text/plain");
  })()`);
  assert.equal(await evaluate(`window.__smokeCopiedDraft`), `Dock ${token}`, "copy preserves inline emoji identity");
  await evaluate(`(() => {
    const field = ${field}, range = document.createRange();
    range.selectNode(field.querySelector("[data-emoji-token]"));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const data = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent("cut", {clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  assert.equal(await evaluate(`${field}.querySelectorAll('[data-emoji-token]').length`), 0, "cut removes custom emoji");
  await click('[aria-label="Add emoji or GIF"]');
  await waitFor(`Boolean(document.querySelector('[aria-label="Use pepe-pray"]'))`, "replacement emoji");
  await click('[aria-label="Use pepe-pray"]');
  await click('[aria-label="Send"]');
  await waitFor(`window.__smokeTaskRequests.at(-1)?.body === ${JSON.stringify(`Dock ${token}`)}`, "dock sends inline emoji");
  await evaluate(`document.querySelector('[aria-label^="Minimize "]').click(); true`);
  await waitFor(`Boolean(document.querySelector('[aria-label^="Open chat with "]'))`, "minimized dock for radius checks");
  const originalRadius = await evaluate(`document.documentElement.style.getPropertyValue("--radius")`);
  for (const radius of [0, 0.5, 1.5]) {
    const shape = await evaluate(`(() => {
      document.documentElement.style.setProperty("--radius", "${radius}rem");
      const strip = document.querySelector('[aria-label="Open chats"]');
      const tab = strip.querySelector('[aria-label^="Open chat with "]').parentElement;
      const launcher = document.querySelector('[aria-label="Message someone"]');
      return {background:getComputedStyle(strip).backgroundColor,
        radius:parseFloat(getComputedStyle(tab).borderTopLeftRadius),
        overflow:getComputedStyle(tab).overflow,
        closeWidth:tab.querySelector('[aria-label^="Close chat with "]').getBoundingClientRect().width,
        launcherRadius:getComputedStyle(launcher).borderTopLeftRadius};
    })()`);
    assert.equal(shape.background, "rgba(0, 0, 0, 0)", "no rectangular backdrop behind curved tabs");
    assert.equal(shape.radius, Math.min(radius * 16, 12), "tab radius follows theme up to a safe cap");
    assert.equal(shape.overflow, "hidden", "hover surfaces stay inside tab corners");
    assert.equal(shape.closeWidth, 28, "close action retains its hit target");
    assert.equal(shape.launcherRadius, "9999px", "message launcher stays circular");
  }
  await evaluate(`document.documentElement.style.setProperty("--radius", ${JSON.stringify(originalRadius)}); true`);
  console.log("ok   Chat dock: transparent tab backdrop and safe corners at zero, normal, and maximum radius.");
  console.log("ok   Chat composer: cursor insertion, inline custom/built-in emojis, undo/redo, safe paste, sending and clearing.");
}

module.exports = {runChatComposer};
