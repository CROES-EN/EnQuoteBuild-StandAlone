/* global process */

const assert = require("node:assert/strict");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRetro(win, {arcadeOnly = false} = {}) {
  const evaluate = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw new Error(`Renderer evaluation failed (${String(code).slice(0, 400)}): ${error.message}`);
    }
  };
  async function waitFor(code, description) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    const state = await evaluate(`({hash:location.hash, preview:document.querySelector("iframe")?.srcdoc?.slice(-800), text:document.body.innerText.slice(-500)})`);
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
  }
  await evaluate('location.hash = "#/Workload?tab=saved"');
  await waitFor(`Boolean(document.querySelector('button[aria-label="Change color theme"]'))`, "signed-in layout");
  await evaluate(`(() => {
    const keys = ["ArrowLeft","ArrowDown","ArrowRight","ArrowUp","ArrowLeft","ArrowDown","ArrowRight","ArrowUp"];
    for (const key of keys) document.body.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
  })()`);
  await waitFor(`location.hash === "#/Base44_DTO" && [...document.querySelectorAll("button")].some((item) => item.textContent.trim() === "Edit my space")`, "hidden profile page");
  assert.equal(await evaluate('location.hash'), "#/Base44_DTO");
  const click = async (text) => {
    const found = await evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(found, true, `Button exists: ${text}`);
    await sleep(400);
  };
  await click("Search");
  assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label")`), "Search retro profiles");
  await waitFor(`[...document.querySelectorAll("strong")].some((item) => item.textContent === "Retro Teammate")`, "loaded directory");
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search retro profiles"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "teammate");
    input.dispatchEvent(new Event("input", {bubbles:true}));
  })()`);
  await waitFor(`![...document.querySelectorAll("strong")].some((item) => item.textContent === "Tom")`, "filtered directory");
  await click("Home");
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Search retro profiles"]').value`), "");
  assert.equal(await evaluate(`document.querySelector('nav[aria-label="EnQuote Space quicklinks"] button[title^="Forum:" ]').disabled`), true);
  await click("Games");
  await waitFor(`location.hash === "#/Base44_DTO?games=1" && Boolean(document.querySelector('[aria-label="EnSpace Games"]'))`, "arcade navigation");
  win.showInactive();
  assert.equal(await evaluate(`document.body.innerText.includes("EST. 1985")`), false);
  if (process.env.ENQUOTE_ARCADE_SCREENSHOT) {
    await sleep(300);
    require("node:fs").writeFileSync(process.env.ENQUOTE_ARCADE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  await click("Play Snake");
  await click("Start");
  assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label").startsWith("Snake board")`), true);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowUp", bubbles:true}))`);
  const frames = [];
  for (let sample = 0; sample < 6; sample++) {
    frames.push(await evaluate(`document.querySelector('[data-testid="arcade-snake-head"]').getAttribute("transform")`));
    await sleep(25);
  }
  assert.ok(new Set(frames).size >= 3, `Snake moves on animation frames rather than snapping once per grid tick: ${JSON.stringify(frames)}`);
  await click("Pause");
  assert.equal(await evaluate(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]').textContent.includes("Paused")`), true);
  await click("Resume");
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] .enspace-score').textContent.includes("Game over")`, "completed Snake score");
  await waitFor(`document.body.innerText.includes("Shared leaderboard updated.")`, "shared Snake best");
  assert.equal(await evaluate(`window.__smokeCalls["retroGames.score"]`), 1, "a completed run uploads once");
  await click("Back to games");
  await click("Play Memory Match");
  const card = `[...document.querySelectorAll('[aria-label="EnSpace Games"] button')].find(button => button.getAttribute("aria-label")?.startsWith("Card 1:"))`;
  await evaluate(`(${card}).click()`);
  assert.equal(await evaluate(`Boolean((${card}).querySelector('svg'))`), true);
  await evaluate(`window.__arcadeOriginalRandom = Math.random; Math.random = () => 0; true`);
  await click("New game");
  await evaluate(`Math.random = window.__arcadeOriginalRandom; delete window.__arcadeOriginalRandom`);
  assert.equal(await evaluate(`(${card}).textContent.trim()`), "?");
  for (let index = 0; index < 8; index++) {
    await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('[aria-label="EnSpace Games"] button[aria-label^="Card "]')];
      buttons[${index}].click();
    })()`);
    await sleep(30);
    await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('[aria-label="EnSpace Games"] button[aria-label^="Card "]')];
      buttons[${index + 8}].click();
    })()`);
    await sleep(30);
  }
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] .enspace-score').textContent.includes("All pairs found in 8 moves")`, "Memory Match completion");
  await waitFor(`window.__smokeArcadeScores.memory === 8`, "shared memory best");
  assert.equal(await evaluate(`window.__smokeCalls["retroGames.score"]`), 2, "Memory Match uploads only after completion");
  await click("Back to games");
  await click("High scores");
  await waitFor(`Boolean(document.querySelector('[aria-label="Arcade high scores"]')) && document.body.innerText.includes("smoke.test@enphaseenergy.com: 8")`, "shared leaderboard");
  assert.ok(await evaluate(`document.querySelector('[aria-label="Arcade high scores"]').textContent.includes("This PC: 8")`), "personal best is durable");
  await click("Sync personal bests");
  await waitFor(`document.body.innerText.includes("Personal bests synced.")`, "retry saved personal scores");
  await click("Back to games");
  await click("Play Tic-Tac-Toe");
  await evaluate(`document.querySelector('button[aria-label="Row 1, column 1: empty"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="EnSpace Games"] button[aria-label$=": X"]').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="EnSpace Games"] button[aria-label$=": O"]').length`), 1);
  await click("Back to games");
  await click("Play Solitaire");
  await evaluate(`document.querySelector('button[aria-label^="Draw a card."]').click()`);
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]').textContent.includes("Moves: 1")`, "solitaire draw");
  await click("Undo");
  assert.equal(await evaluate(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]').textContent`), "Moves: 0");
  await click("Back to games");
  await click("Play Neon Rider");
  await click("Expand map");
  await click("Expand map");
  await click("Fit map");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Neon Rider track drawing canvas"]').getAttribute("viewBox")`), "0 0 14400 8000");
  await click("View start");
  await click("Ride");
  await sleep(150);
  assert.ok(await evaluate(`document.querySelector('[aria-label="EnSpace Games"] .enspace-score').textContent.startsWith("riding")`));
  await click("Pause ride");
  await click("Clear track");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Neon Rider track drawing canvas"]').querySelectorAll('line').length`), 0);
  await click("Fit map");
  const canvas = await evaluate(`(() => {
    const canvas = document.querySelector('[aria-label="Neon Rider track drawing canvas"]');
    canvas.scrollIntoView({block:"center"});
    const rect = canvas.getBoundingClientRect();
    return {x:Math.round(rect.x+rect.width*.4),y:Math.round(rect.y+rect.height*.4),
      endX:Math.round(rect.x+rect.width*.6),endY:Math.round(rect.y+rect.height*.5)};
  })()`);
  win.webContents.sendInputEvent({type: "mouseDown", x: canvas.x, y: canvas.y, button: "left", clickCount: 1});
  win.webContents.sendInputEvent({type: "mouseMove", x: canvas.endX, y: canvas.endY, button: "left"});
  win.webContents.sendInputEvent({type: "mouseUp", x: canvas.endX, y: canvas.endY, button: "left", clickCount: 1});
  await waitFor(`document.querySelector('[aria-label="Neon Rider track drawing canvas"]').querySelectorAll('line').length > 0`, "drawn track");
  assert.ok(await evaluate(`Number(document.querySelector('[aria-label="Neon Rider track drawing canvas"] line').getAttribute('x2')) > 900`),
    "drawing uses expanded world coordinates rather than the original 900-pixel canvas");
  await click("Undo stroke");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Neon Rider track drawing canvas"]').querySelectorAll('line').length`), 0);
  await click("View start");
  await click("Example track");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Neon Rider track drawing canvas"]').querySelectorAll('line').length`), 4);
  await click("Back to games");
  await click("Challenge a teammate");
  await waitFor(`Boolean(document.querySelector('.enspace-arcade-select option[value="teammate@example.invalid"]'))`, "challenge directory");
  await evaluate(`(() => {
    const field = document.querySelector('.enspace-arcade-select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(field, "teammate@example.invalid");
    field.dispatchEvent(new Event("change", {bubbles:true}));
  })()`);
  await click("Send challenge");
  await waitFor(`document.body.innerText.includes("Cancel invitation")`, "created online challenge");
  await click("Cancel invitation");
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]')?.textContent === "cancelled"`, "cancelled challenge");
  await click("Back to challenges");
  await evaluate(`window.__smokeGames.unshift({
    id:"incoming-tic",kind:"tic",challenger:"teammate@example.invalid",opponent:"smoke.test@enphaseenergy.com",
    status:"pending",turn:"teammate@example.invalid",version:1,board:Array(9).fill(null)
  })`);
  await waitFor(`document.body.innerText.includes("(invited you)")`, "incoming invitation");
  await click("Open match");
  await click("Accept");
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]')?.textContent === "Opponent's turn"`, "accepted match");
  await evaluate(`(() => {
    const game = window.__smokeGames.find(game=>game.id==="incoming-tic");
    game.board[0]="X";game.turn="smoke.test@enphaseenergy.com";game.version++;
  })()`);
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]')?.textContent === "Your turn"`, "opponent move refresh");
  await evaluate(`document.querySelector('button[aria-label="Online row 1, column 2: empty"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="Online row 1, column 2: O"]'))`, "online move");
  await click("Back to challenges");
  await evaluate(`window.__smokeGames.unshift({
    id:"incoming-memory",kind:"memory",challenger:"teammate@example.invalid",opponent:"smoke.test@enphaseenergy.com",
    status:"pending",turn:"teammate@example.invalid",version:1,cards:Array(16).fill(null),open:[],matched:[],
    scores:{"teammate@example.invalid":0,"smoke.test@enphaseenergy.com":0}
  })`);
  await waitFor(`[...document.querySelectorAll('li')].some(item=>item.textContent.includes('Memory Match'))`, "incoming memory challenge");
  await evaluate(`[...document.querySelectorAll('li')].find(item=>item.textContent.includes('Memory Match')).querySelector('button').click()`);
  await click("Accept");
  await evaluate(`window.__smokeGames.find(game=>game.id==="incoming-memory").turn="smoke.test@enphaseenergy.com"`);
  await waitFor(`document.querySelector('[aria-label="EnSpace Games"] [role="status"]')?.textContent === "Your turn"`, "online memory turn");
  await evaluate(`document.querySelector('button[aria-label="Online card 1: face down"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="Online card 1: SUN"] svg'))`, "online memory icon reveal");
  await evaluate(`document.querySelector('button[aria-label="Online card 2: face down"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="Online card 2: SUN, matched"]'))`, "online matching pair");
  await click("Back to challenges");
  for (const [kind, name] of [["connect","Connect Four"],["checkers","Checkers"],["battleship","Battleship"]]) {
    await click("Back to games");
    await click(`Play ${name}`);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="EnSpace Games"] select')[1].value`), kind, `${name} tile preselects its challenge game`);
    await waitFor(`document.querySelectorAll('[aria-label="EnSpace Games"] select')[0]?.textContent.includes("Retro Teammate")`, "published EnSpace teammate name");
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="EnSpace Games"] select')[0].textContent.includes("unpublished@example.invalid")`), false, "unpublished users excluded");
    await evaluate(`(() => {
      const selects = document.querySelectorAll('[aria-label="EnSpace Games"] select');
      for (const [select, value] of [[selects[0],"teammate@example.invalid"]]) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,value);
        select.dispatchEvent(new Event("change",{bubbles:true}));
      }
    })()`);
    await click("Send challenge");
    await waitFor(`document.querySelector('[aria-label="EnSpace Games"] h4')?.textContent.startsWith(${JSON.stringify(name)})`, `${name} invitation`);
    await evaluate(`(() => {
      const game=window.__smokeGames.at(-1);game.status="active";game.version++;
    })()`);
    await waitFor(`Boolean(document.querySelector('[aria-label="${kind === "connect" ? "Connect Four board" : kind === "checkers" ? "Checkers board" : "Your Battleship fleet"}"]'))`, `${name} board`);
    if (kind === "connect") {
      await evaluate(`document.querySelector('[aria-label="Drop in column 1"]').click()`);
      await waitFor(`document.querySelector('[aria-label="Row 6, column 1: X"]')?.textContent === "X"`, "Connect Four saved drop");
    } else if (kind === "checkers") {
      await evaluate(`document.querySelector('[aria-label="Checkers row 6, column 1: your piece"]').click()`);
      await evaluate(`document.querySelector('[aria-label="Checkers row 5, column 2: empty"]').click()`);
      await waitFor(`Boolean(document.querySelector('[aria-label="Checkers row 5, column 2: your piece"]'))`, "Checkers saved move");
    } else {
      await evaluate(`document.querySelector('[aria-label="Fleet A1: water"]').click()`);
      await waitFor(`Boolean(document.querySelector('[aria-label="Fleet E1: ship"]'))`, "manual saved ship placement");
    }
    await click("Mail");
    await click("Games");
    await click(`Play ${name}`);
    await waitFor(`[...document.querySelectorAll('li')].some(item=>item.textContent.includes(${JSON.stringify(name)}))`, "saved match lobby");
    await evaluate(`[...document.querySelectorAll('li')].find(item=>item.textContent.includes(${JSON.stringify(name)})).querySelector('button').click()`);
    await waitFor(`Boolean(document.querySelector('[aria-label="${kind === "connect" ? "Row 6, column 1: X" : kind === "checkers" ? "Checkers row 5, column 2: your piece" : "Fleet E1: ship"}"]'))`, `${name} restored after screen closes`);
    if (kind === "battleship") {
      await click("Horizontal");
      await click("Randomize fleet");
      await click("Ready to battle");
      await waitFor(`document.body.innerText.includes("Fleet locked.")`, "locked private fleet");
      await evaluate(`(() => {
        const game=window.__smokeGames.at(-1);game.phase="playing";game.ready[game.opponent]=true;game.turn=game.challenger;game.version++;
      })()`);
      await waitFor(`Boolean(document.querySelector('[aria-label="Battleship targets"]'))`, "ready enemy waters");
      await evaluate(`document.querySelector('[aria-label="Fire at A1: unknown"]').click()`);
      await waitFor(`Boolean(document.querySelector('[aria-label="Fire at A1: hit"]'))`, "saved Battleship shot");
      await click("Back to challenges");
      await evaluate(`[...document.querySelectorAll('li')].find(item=>item.textContent.includes("Battleship")).querySelector('button').click()`);
      await waitFor(`Boolean(document.querySelector('[aria-label="Fire at A1: hit"]'))`, "restored Battleship shot");
    }
    await click("Back to challenges");
  }
  await click("Back to games");
  await evaluate(`window.__smokeGamesUnavailable=true; true`);
  await click("Play Connect Four");
  await waitFor(`document.body.innerText.includes("Online games require the updated EnQuote Worker")`, "missing games service error");
  await waitFor(`document.querySelectorAll('[aria-label="EnSpace Games"] select')[0]?.textContent.includes("Retro Teammate")`, "profiles still load when games service is unavailable");
  assert.equal(await evaluate(`[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Send challenge").disabled`), true);
  const failedCalls = await evaluate(`window.__smokeCalls["retroGames.list"]`);
  await sleep(5500);
  assert.equal(await evaluate(`window.__smokeCalls["retroGames.list"]`), failedCalls, "permanent deployment errors do not repeatedly poll");
  await evaluate(`delete window.__smokeGamesUnavailable; true`);
  await click("Refresh");
  await waitFor(`!document.body.innerText.includes("Online games require the updated EnQuote Worker")`, "manual refresh recovers after service deployment");
  await click("Mail");
  assert.equal(await evaluate(`location.hash`), "#/Base44_DTO?mail=1");
  await click("Games");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="EnSpace Games"]'))`), true);
  await click("Search");
  await waitFor(`document.activeElement.getAttribute("aria-label") === "Search retro profiles"`, "search after games");
  await click("Home");
  win.hide();
  if (arcadeOnly) {
    await click("Back to EnQuote");
    assert.equal(await evaluate("location.hash"), "#/Workload?tab=saved");
    console.log("ok   EnSpace arcade: local games, scores, large maps, all five online games, saved boards/setup after reopening, and return navigation.");
    return;
  }
  await click("Edit my space");
  assert.equal(await evaluate(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`), "Classic blue");
  assert.equal(await evaluate(`[...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "My theme").disabled`), true, "My theme waits for pasted code");
  const setThemeCode = (code) => evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="Theme code"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(code)});
    field.dispatchEvent(new Event("input", {bubbles:true}));
  })()`);
  await setThemeCode("https://layouts.spacehey.com/layout?id=611");
  await waitFor(`document.body.innerText.includes("That's a link to the layout")`, "link guidance");
  await setThemeCode("https://www.pimp-my-profile.com/myspace-layouts/");
  await waitFor(`document.querySelector('textarea[aria-label="Theme code"]')?.value === "https://www.pimp-my-profile.com/myspace-layouts/" && document.body.innerText.includes("That's a link to the layout")`, "Pimp My Profile link guidance");
  await setThemeCode('<!-- layout created by Smoke Tester (thanks) --><style>body{background:url("https://example.invalid/bg.gif") rgb(60,50,40)}.profile-pic:after{background-image:url("https://example.invalid/theme-pfp.gif");content:"";display:inline-block}</style>\nCODE BELOW GOES HERE\n<img src="giforimageurl">');
  await waitFor(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim() === "My theme"`, "theme selected automatically");
  const summary = await evaluate(`[...document.querySelectorAll('[role="status"]')].find((item) => item.textContent.includes("Theme added"))?.textContent || ""`);
  assert.ok(summary.includes("by Smoke Tester") && summary.includes("background art") && summary.includes("setup notes") && summary.includes("1 placeholder image"), summary);
  await waitFor(`document.querySelector("iframe")?.srcdoc.includes("rgb(60,50,40)") || document.querySelector("iframe")?.srcdoc.includes("rgb(60, 50, 40)")`, "live theme preview");
  let themePictureHidden = null;
  const pictureDeadline = Date.now() + 10000;
  while (themePictureHidden === null && Date.now() < pictureDeadline) {
    for (const frame of win.webContents.mainFrame.framesInSubtree) {
      if (frame === win.webContents.mainFrame) continue;
      const state = await frame.executeJavaScript(`(() => {
        const slot = document.querySelector(".profile-pic");
        if (!slot) return null;
        const after = getComputedStyle(slot, "::after");
        return after.display === "none" && after.backgroundImage === "none";
      })()`).catch(() => null);
      if (state !== null) themePictureHidden = state;
    }
    if (themePictureHidden === null) await sleep(200);
  }
  assert.equal(themePictureHidden, true, "Theme-supplied profile pictures are hidden");
  const frameState = async (code, description) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      for (const frame of win.webContents.mainFrame.framesInSubtree) {
        if (frame === win.webContents.mainFrame) continue;
        const state = await frame.executeJavaScript(code).catch(() => null);
        if (state) return state;
      }
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${description}`);
  };
  await setThemeCode(':root{--lighter-blue:#8e0d3e;--light-orange:#8e0d3e}html::before{content:"";position:fixed;inset:0;z-index:100000;background:rgb(0,90,0)}main{transform:rotate(-2deg) scale(1.3)}.profile{color:#ff0095}.profile .contact,.profile .blurbs,.profile .table-section{background:#520030;border:6px double #ff0095}');
  const kitty = await frameState(`(() => {
    const panel = document.querySelector(".profile .blurbs");
    if (!panel || !document.body.style.getPropertyValue("--eqp-glass")) return null;
    const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
    return {plain: document.documentElement.classList.contains("eqp-plain"), panel: getComputedStyle(panel).backgroundColor, border: getComputedStyle(panel).borderTopStyle + " " + getComputedStyle(panel).borderTopColor,
      heading: style(".profile .contact>.heading").backgroundColor, ink: style(".profile .blurbs .section p").color, overlay: style("html", "::before").zIndex, transform: style("main").transform};
  })()`, "theme palette");
  assert.equal(kitty.plain, false);
  assert.equal(kitty.panel, "rgb(82, 0, 48)", "Theme panel color is kept");
  assert.equal(kitty.border, "double rgb(255, 0, 149)", "Theme borders are kept");
  assert.equal(kitty.heading, "rgb(142, 13, 62)", "SpaceHey color variables restyle headings");
  assert.match(kitty.ink, /^rgb\(255, \d+, \d+\)$/, `Theme text color stays pink but readable: ${kitty.ink}`);
  assert.equal(kitty.overlay, "-1", "Full-screen theme art sits behind the profile while editing");
  assert.equal(kitty.transform, "none", "Theme geometry cannot rotate the profile");
  await setThemeCode('<style>.online{content:url("https://example.invalid/online.gif")}</style><img src="https://example.invalid/blinkie.gif">');
  const snippet = await frameState(`document.documentElement.classList.contains("eqp-plain") && document.querySelector(".eqp-theme-extras img") ? getComputedStyle(document.querySelector(".profile .contact>.heading")).backgroundColor : null`, "snippet theme on classic look");
  assert.equal(snippet, "rgb(115, 160, 190)", "Snippet-only themes keep the classic look");
  await click("Remove theme");
  await waitFor(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim() === "Classic blue" && !document.querySelector('textarea[aria-label="Theme code"]').value`, "theme removed");
  await click("Clean Gothic");
  await waitFor(`document.querySelector("iframe")?.srcdoc.includes("#16131c") && document.querySelector("iframe").srcdoc.includes("data:image/gif;base64,")`, "Gothic preview with uploaded avatar");
  assert.equal(await evaluate(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`), "Clean Gothic");
  if (process.env.ENQUOTE_EDITOR_SCREENSHOT) {
    win.showInactive();
    await evaluate(`[...document.querySelectorAll("h2")].find((heading) => heading.textContent === "Customize my space").scrollIntoView({block:"start"})`);
    await sleep(500);
    require("node:fs").writeFileSync(process.env.ENQUOTE_EDITOR_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    win.hide();
  }
  const classicPreviewSource = await evaluate(`document.querySelector("iframe").srcdoc`);
  assert.ok(classicPreviewSource.includes("#16131c"), "Selected Gothic appearance is applied to the profile");
  assert.ok(classicPreviewSource.includes("min-height:0!important"), "Profile frame wraps its content without forcing a full-screen blank panel");
  if (process.env.ENQUOTE_CLASSIC_SCREENSHOT) {
    win.showInactive();
    await evaluate(`document.querySelector("iframe").scrollIntoView({block:"center"})`);
    await sleep(500);
    require("node:fs").writeFileSync(process.env.ENQUOTE_CLASSIC_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    win.hide();
  }
  const classicSource = await evaluate(`document.querySelector("iframe").srcdoc`);
  assert.ok(classicSource.includes("letter-spacing:normal"), "Classic typography overrides imported tracking");
  assert.ok(classicSource.includes("grid-template-columns:300px minmax(0,1fr)"), "Profile matches Tom's two-column fit");
  assert.ok(classicSource.includes("padding:0!important;border:0!important") && classicSource.includes("border-radius:0 0 8px 8px"), "Profile box sits flush beneath the page header");
  assert.ok(classicSource.includes("profile-center") && classicSource.includes("profile-side") && classicSource.includes("box-shadow:0 2px 8px"), "Sections render in separate framed rails");
  assert.ok(classicSource.includes('class="row profile"') && classicSource.includes('class="table-section"'), "SpaceHey-compatible structure is rendered");
  assert.ok(classicSource.includes("data:image/gif;base64,"), "Uploaded profile GIF is embedded into preview");
  assert.ok(classicSource.includes('class="friend-pic" src="https://pbs.twimg.com/profile_images/1237550450/mstom_400x400.jpg"'), "Friend Space shows friend pictures");
  assert.ok(classicSource.includes('<div class="friend-placeholder">R</div><p>Retro Teammate</p>'), "Published teammates appear in Friend Space");
  if (process.env.ENQUOTE_CLASSIC_SCREENSHOT) {
    win.showInactive();
    await evaluate(`document.querySelector("iframe").scrollIntoView({block:"center"})`);
    await sleep(500);
    require("node:fs").writeFileSync(process.env.ENQUOTE_CLASSIC_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    win.hide();
  }
  await click("Publish my page");
  await waitFor(`Boolean(window.__smokeRetroProfile?.html?.includes('class="row profile"'))`, "published classic profile");
  assert.ok((await evaluate(`document.querySelector('iframe').srcdoc`)).includes("About me"), "CSS-only profile has real content");
  assert.equal(await evaluate(`[...document.querySelectorAll("h2")].some((heading) => heading.textContent === "Customize my space")`), false, "Publishing opens viewing mode");
  await click("View my page");
  await waitFor(`Boolean(document.querySelector('iframe'))`, "own page");
  await waitFor(`document.querySelector('iframe[title="Isolated retro profile preview"]')?.srcdoc.includes('<img src="data:image/gif;base64,')`, "own picture on published page");
  assert.equal(await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').getAttribute("sandbox")`), "allow-scripts", "Classic profiles allow only the friend-link script");
  assert.match(await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').srcdoc`), /script-src 'nonce-[a-f0-9]{32}'/);
  let tileClicked = false;
  const frameDeadline = Date.now() + 10000;
  while (!tileClicked && Date.now() < frameDeadline) {
    for (const frame of win.webContents.mainFrame.framesInSubtree) {
      if (frame === win.webContents.mainFrame) continue;
      try {
        tileClicked = await frame.executeJavaScript(`(() => {
          const tile = [...document.querySelectorAll("[data-friend]")].find((item) => item.textContent.includes("Retro Teammate"));
          if (!tile) return false;
          tile.click();
          return true;
        })()`);
      } catch (frameError) {
        void frameError;
      }
      if (tileClicked) break;
    }
    if (!tileClicked) await sleep(200);
  }
  if (!tileClicked) console.error("[smoke] frames:", await Promise.all(win.webContents.mainFrame.framesInSubtree.map((frame) => frame.executeJavaScript("document.body?.innerText.slice(0,300)").catch((frameError) => frameError.message))));
  assert.equal(tileClicked, true, "Friend Space tile is clickable inside the profile frame");
  await waitFor(`document.querySelector('iframe[title="Isolated retro profile preview"]')?.srcdoc.includes("Teammate profile")`, "friend page opened from Friend Space");
  assert.equal(await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').getAttribute("sandbox")`), "", "Custom profiles stay script-free");
  await click("View my page");
  await waitFor(`document.querySelector('iframe[title="Isolated retro profile preview"]')?.srcdoc.includes('<img src="data:image/gif;base64,')`, "own page again");
  if (process.env.ENQUOTE_PROFILE_VIEW_SCREENSHOT) {
    win.showInactive();
    await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').scrollIntoView({block:"center"})`);
    await sleep(1500);
    require("node:fs").writeFileSync(process.env.ENQUOTE_PROFILE_VIEW_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    win.hide();
  }
  await click("Edit my space");
  await evaluate(`document.querySelector('input[aria-label="Use fully custom HTML"]').click()`);
  await waitFor(`document.querySelectorAll("textarea").length === 2`, "custom HTML editor");
  await waitFor(`(() => {
    const logo = document.querySelector('h1 img');
    return logo?.complete && logo.naturalWidth === 1024 && logo.naturalHeight === 379;
  })()`, "packaged custom logo");
  async function assertEditorContrast() {
    const controls = await evaluate(`(() => {
      const luminance = (color) => {
        const channels = color.match(/[\\d.]+/g).slice(0,3).map(Number).map((value) => {
          value /= 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      return [...document.querySelectorAll("input:not([type=checkbox]), textarea")].map((control) => {
        const style = getComputedStyle(control);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return {contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)};
      });
    })()`);
    assert.equal(controls.length, 5, "Search, name, mood, HTML and CSS checked");
    for (const control of controls) assert.ok(control.contrast >= 4.5, `Editor text contrast >= 4.5: ${control.contrast}`);
  }
  await assertEditorContrast();
  const themePosition = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Change color theme"]');
    button.scrollIntoView({block: "nearest"});
    const rect = button.getBoundingClientRect();
    return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
  })()`);
  win.webContents.sendInputEvent({type: "mouseDown", ...themePosition, button: "left", clickCount: 1});
  win.webContents.sendInputEvent({type: "mouseUp", ...themePosition, button: "left", clickCount: 1});
  await waitFor(`Boolean(document.querySelector('[role="menu"][data-state="open"]'))`, "theme menu");
  await evaluate(`[...document.querySelectorAll("button[aria-pressed]")].find((button) => [...button.querySelectorAll("span")].some((span) => span.textContent === "Monokai")).click()`);
  await waitFor(`document.documentElement.dataset.theme === "monokai"`, "dark theme");
  await sleep(250);
  await assertEditorContrast();
  win.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
  win.webContents.sendInputEvent({type: "keyUp", keyCode: "Escape"});
  await waitFor(`document.querySelector('[role="menu"][data-state="open"]') === null`, "closed theme menu");
  assert.equal(await evaluate(`document.querySelector('a[href="https://layouts.spacehey.com/"]').getAttribute("rel")`), "noopener noreferrer");
  assert.equal(await evaluate(`document.querySelector('a[href="https://www.pimp-my-profile.com/myspace-layouts/"]').getAttribute("rel")`), "noopener noreferrer");
  async function checkPastedStyles(html, css, expectedColor) {
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      const fields = document.querySelectorAll("textarea");
      setter.call(fields[0], ${JSON.stringify(html)});
      fields[0].dispatchEvent(new Event("input", {bubbles:true}));
      setter.call(fields[1], ${JSON.stringify(css)});
      fields[1].dispatchEvent(new Event("input", {bubbles:true}));
    })()`);
    const normalizedColor = expectedColor.replaceAll(" ", "");
    await waitFor(`(() => { const source = document.querySelector("iframe")?.srcdoc || ""; return source.includes(${JSON.stringify(`background:${normalizedColor}`)}) || source.includes(${JSON.stringify(`background: ${expectedColor}`)}); })()`, `live preview ${expectedColor}`);
    const source = await evaluate(`document.querySelector("iframe").srcdoc`);
    assert.ok(source.includes(`background:${normalizedColor}`) || source.includes(`background: ${expectedColor}`), "Pasted CSS is extracted into profile styles");
    assert.equal(await evaluate(`document.querySelector("iframe").getAttribute("sandbox")`), "");
  }
  await checkPastedStyles('<style>body{background:rgb(30,20,40)}</style><h1>Background test</h1>', "", "rgb(30, 20, 40)");
  await checkPastedStyles("<h1>Background test</h1>", '<!-- Layout credit --><style>body{background:rgb(40,30,20)}</style><div class="decoration">Decoration</div><script>alert(1)</script>', "rgb(40, 30, 20)");
  assert.ok((await evaluate(`document.querySelector("iframe").srcdoc`)).includes('class="decoration"'), "Pasted layout decorations are preserved");
  await checkPastedStyles("<h1>Template test</h1>", '<style>body{background:rgb(50,40,30)}</style>\nCODE BELOW GOES UNDER YOUR ABOUT ME PARAGRAPH\n<img src="giforimageurl"/><img src="imageorglittertexturl"/>\n<center><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"> TO ADD YOUTUBE VIDEO PASTE HERE</center><div class="snowflakes"><div class="snowflake">x</div></div>', "rgb(50, 40, 30)");
  const templateSource = await evaluate(`document.querySelector("iframe").srcdoc`);
  assert.equal(/CODE BELOW|YOUTUBE VIDEO/.test(templateSource), false, "Theme setup instructions are not rendered as page content");
  assert.equal(/giforimageurl|imageorglittertexturl/.test(templateSource), false, "Placeholder theme images are dropped");
  assert.ok(templateSource.includes('<div class="eqp-theme-extras"><img src="data:image/gif;base64,'), "Loadable loose theme images are framed together");
  assert.ok(templateSource.includes('<div class="snowflakes"><div class="snowflake">x</div></div>'), "Named theme decorations keep their content");
  assert.equal((await evaluate(`document.querySelector("iframe").srcdoc`)).includes("<script>"), false);
  await evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const fields = document.querySelectorAll("textarea");
    setter.call(fields[0], '<h1>Retro test</h1><script>parent.postMessage("retro-script-ran","*")</script><iframe src="https://example.invalid"></iframe><img src="data:image/png;base64,invalid" onerror="parent.postMessage(\\'retro-handler-ran\\',\\'*\\')"><a href="https://example.invalid">Link</a>');
    fields[0].dispatchEvent(new Event("input", {bubbles:true}));
    setter.call(fields[1], 'body{background: pink}</style><script>parent.postMessage("retro-css-ran","*")</script>');
    fields[1].dispatchEvent(new Event("input", {bubbles:true}));
    window.__retroMessages = [];
    window.addEventListener("message", (event) => { if (typeof event.data === "string" && event.data.startsWith("retro-")) window.__retroMessages.push(event.data); });
  })()`);
  await waitFor(`document.querySelector("iframe")?.srcdoc.includes("Retro test")`, "live custom preview");
  await waitFor(`(() => {
    const iframe = document.querySelector('iframe[title="Isolated retro profile preview"]');
    return Boolean(iframe && iframe.contentDocument === null);
  })()`, "opaque preview frame");
  const frame = await evaluate(`(() => {
    const iframe = document.querySelector('iframe[title="Isolated retro profile preview"]');
    return {sandbox: iframe.getAttribute("sandbox"), opaque: iframe.contentDocument === null, source: iframe.srcdoc};
  })()`);
  assert.equal(frame.sandbox, "");
  assert.equal(frame.opaque, true);
  assert.equal(frame.source.includes('onerror='), false);
  assert.equal(frame.source.includes('<script>'), false);
  assert.equal(frame.source.includes('<iframe'), false);
  assert.equal(frame.source.includes('href="https://example.invalid"'), false);
  assert.ok(frame.source.includes("script-src 'none'"));
  assert.deepEqual(await evaluate("window.__retroMessages"), []);
  await click("Publish my page");
  await waitFor(`Boolean(window.__smokeRetroProfile?.html?.includes("Retro test"))`, "published profile");
  assert.ok((await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').srcdoc`)).includes("html,body{background:transparent!important;margin:0!important") && (await evaluate(`document.querySelector('iframe[title="Isolated retro profile preview"]').srcdoc`)).includes("html body .container{box-sizing:border-box!important;width:100%!important;max-width:none!important"), "Viewing profile shares the background and pins custom layouts under the header");
  assert.ok((await evaluate(`document.querySelector('iframe[title="Profile theme background"]').srcdoc`)).includes("background: pink"), "Full-viewport theme layer retains the imported body background");
  assert.ok((await evaluate("window.__smokeRetroProfile.html")).includes("Retro test"));
  assert.equal(await evaluate(`document.querySelector('section[aria-label="Profile contact quicklinks"]') === null && [...document.querySelectorAll("header button")].some((button) => button.textContent === "Edit my profile")`), true, "Own profile shows a header edit button instead of a contact bar");
  await click("Stop preview");
  assert.equal(await evaluate("document.querySelector('iframe') === null"), true);
  const tomFound = await evaluate(`(() => {
    document.querySelector('details[aria-label="Profile directory"]').open = true;
    const button = [...document.querySelectorAll("button")].find((item) => item.querySelector("strong")?.textContent === "Tom");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(tomFound, true);
  await waitFor(`document.querySelector('iframe')?.srcdoc.includes("Tom's Blurbs")`, "Tom tribute profile");
  const tributeSource = await evaluate(`document.querySelector('iframe').srcdoc`);
  for (const section of ["profile-columns", "Contacting Tom", "Tom's Latest Blog Notes", "Tom's Blurbs", "profile-url"]) assert.ok(tributeSource.includes(section), `Classic tribute includes ${section}`);
  const profileSize = await evaluate(`(() => {
    const frame = document.querySelector("iframe");
    const rect = frame.getBoundingClientRect();
    const canvasWidth = frame.parentElement.getBoundingClientRect().width;
    const background = document.querySelector('iframe[title="Profile theme background"]');
    const backgroundRect = background.getBoundingClientRect();
    return {width: rect.width, height: rect.height, border: getComputedStyle(frame).borderTopWidth,
      friendsCollapsed: !document.querySelector('details[aria-label="Profile directory"]').open,
      headerWidth: document.querySelector("header").getBoundingClientRect().width, canvasWidth,
      headerLeft: document.querySelector("header").getBoundingClientRect().left, left: rect.left,
      gap: rect.top - document.querySelector("header").getBoundingClientRect().bottom,
      backgroundSize: {width: backgroundRect.width, height: backgroundRect.height, top: backgroundRect.top, left: backgroundRect.left}};
  })()`);
  assert.equal(profileSize.width, profileSize.headerWidth, "Profile frame matches the page header width");
  assert.equal(profileSize.left, profileSize.headerLeft, "Profile frame aligns with the page header");
  assert.ok(profileSize.gap >= 0 && profileSize.gap <= 1, `Profile sits directly below the header (gap ${profileSize.gap}px)`);
  assert.equal(profileSize.width, profileSize.canvasWidth, "Preview fills the available app canvas");
  assert.ok(profileSize.height >= 400, "Profile fills available viewing height");
  assert.ok(profileSize.headerWidth <= 1100, "Page header and profile share a centered width");
  assert.equal(profileSize.border, "0px", "No oversized preview border");
  assert.deepEqual(profileSize.backgroundSize, {width: await evaluate("window.innerWidth"), height: await evaluate("window.innerHeight"), top: 0, left: 0}, "Theme background reaches every viewport edge, including the top");
  assert.equal(profileSize.friendsCollapsed, true, "Friends list collapses while viewing");
  assert.equal(await evaluate(`document.querySelector('section[aria-label="Profile contact quicklinks"]') === null`), true, "No duplicate Tom contact panel");
  assert.equal(tributeSource.includes("classic-header"), true);
  assert.equal(tributeSource.includes('<header class="classic-header">'), false, "No nested profile header");
  if (process.env.ENQUOTE_PROFILE_SCREENSHOT) {
    win.showInactive();
    await evaluate(`document.querySelector("iframe").scrollIntoView({block: "center"})`);
    await sleep(500);
    require("node:fs").writeFileSync(process.env.ENQUOTE_PROFILE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    win.hide();
  }
  await click("Browse");
  assert.equal(await evaluate(`document.querySelector('details[aria-label="Profile directory"]').open`), true);
  await click("Home");
  assert.equal(await evaluate("document.querySelector('iframe') === null"), true, "Home closes the profile");
  await click("Back to EnQuote");
  assert.equal(await evaluate("location.hash"), "#/Workload?tab=saved");
  assert.equal(await evaluate("document.querySelector('iframe') === null"), true);
  await evaluate(`(() => {
    for (const key of ["ArrowLeft","ArrowDown","ArrowRight","ArrowUp","ArrowLeft","ArrowDown","ArrowRight","ArrowUp"]) document.body.dispatchEvent(new KeyboardEvent("keydown", {key,bubbles:true}));
  })()`);
  await waitFor(`location.hash === "#/Base44_DTO" && [...document.querySelectorAll("strong")].some((item) => item.textContent === "Retro Teammate")`, "shared teammate directory");
  await evaluate(`[...document.querySelectorAll("button")].find((button) => button.querySelector("strong")?.textContent === "Retro Teammate").click()`);
  await waitFor(`Boolean(document.querySelector('section[aria-label="Profile contact quicklinks"]'))`, "teammate mail action");
  await click("Send Mail");
  await waitFor(`location.hash.includes("#/Base44_DTO?mail=1&to=teammate%40example.invalid")`, "separate mail composer");
  assert.equal(await evaluate(`document.querySelector('input[type="email"]')?.value`), "teammate@example.invalid");
  assert.equal(await evaluate(`document.querySelector("form h2")?.textContent`), "New message");
  assert.equal(await evaluate(`window.__smokeDmEmail || ""`), "", "sending profile mail does not open Messages");
  await click("Home");
  await waitFor(`location.hash === "#/Base44_DTO" && Boolean(document.querySelector('nav[aria-label="EnQuote Space quicklinks"]'))`, "profile mail navigation");
  await click("Browse");
  await waitFor(`!document.querySelector('[aria-label="Mail Center"]') && document.querySelector('details[aria-label="Profile directory"]')?.open`, "Browse redirects out of Mail");
  await click("Search");
  assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label")`), "Search retro profiles", "Search redirects out of Mail and focuses profile search");
  await click("Mail");
  await waitFor(`location.hash === "#/Base44_DTO?mail=1" && document.body.innerText.includes("Mail Center")`, "independent Mail Center");
  assert.equal(await evaluate(`Boolean(document.querySelector('nav[aria-label="EnQuote Space quicklinks"]') && document.querySelector('header img[alt="A place for friends"]'))`), true, "Mail remains inside the main Enspace navigation and header");
  assert.equal(await evaluate(`Boolean([...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Back to profile"))`), false, "Mail has no separate Back to profile button");
  const mailTheme = await evaluate(`(() => ({
    appearance: document.querySelector('[aria-label="Mail Center"]')?.dataset.appearance,
    surface: getComputedStyle(document.querySelector(".eq-mail__frame")).backgroundColor,
    backdrop: document.querySelector('iframe[title="Profile theme background"]')?.srcdoc.includes("background: pink")
  }))()`);
  assert.equal(mailTheme.appearance, "gothic", "Mail inherits the current Enspace appearance setting");
  assert.match(mailTheme.surface, /^rgba\(25, 21, 32, 0\.94\)$/);
  assert.equal(mailTheme.backdrop, true, "The selected custom Enspace backdrop is retained in Mail");
  assert.equal(await evaluate(`document.querySelector("form") === null`), true, "opening the Mail Center does not open a Messages composer");
  await click("Browse");
  await waitFor(`!document.querySelector('[aria-label="Mail Center"]') && document.querySelector('details[aria-label="Profile directory"]')?.open`, "Browse redirects out of Mail");
  await click("Search");
  assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label")`), "Search retro profiles");
  await click("Home");
  await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "Edit my space");
    button?.closest("details")?.setAttribute("open", "");
  })()`);
  await click("Edit my space");
  await waitFor(`[...document.querySelectorAll("label")].some((label) => label.textContent.startsWith("CSS") && label.querySelector("textarea"))`, "CSS editor after returning from Mail Center");
  const flushProbe = ".smoke-flush-probe{color:rgb(17,34,51)}";
  await evaluate(`(() => {
    const field = [...document.querySelectorAll("label")].find((label) => label.textContent.startsWith("CSS"))?.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, field.value + ${JSON.stringify(flushProbe)});
    field.dispatchEvent(new Event("input", {bubbles:true}));
  })()`);
  await click("Back to EnQuote");
  const persistedDraft = await evaluate(`(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith("enquote_retro_draft_v1::"));
    return entry ? JSON.parse(entry[1]).css : "";
  })()`);
  assert.ok(persistedDraft.includes(flushProbe), "leaving the editor immediately flushes the latest local draft");
  assert.deepEqual(await evaluate("window.__smokeErrors"), []);
  console.log("ok   Retro: sizing, secret arrows, editor, isolated code, Tom tribute, return navigation, search/browse, separate mail and durable local draft");
}

module.exports = {runRetro};
