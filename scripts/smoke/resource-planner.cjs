const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const SAN_ANTONIO = "100 Smoke Test Ln, San Antonio, TX 78205";
const UNKNOWN = "1 Nowhere Rd, Faketown, TX 79999";

// Roster location workflow against the stand-in bridge (its geocoder is a fixture, so no
// address leaves the machine): check locations, filter to "Needs pin", pin by pasted
// coordinates and save. Every renderer call is bounded so a stuck page fails instead of hanging.
async function runResourcePlanner(win) {
  win.showInactive();
  const evaluate = (code, ms = 5000) => Promise.race([
    win.webContents.executeJavaScript(code),
    sleep(ms).then(() => { throw new Error(`Renderer did not answer within ${ms}ms: ${code.slice(0, 80)}`); })
  ]);
  async function waitFor(code, label, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(code)) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const clickButton = (text, scope = "document") => evaluate(`(() => {
    const button = [...${scope}.querySelectorAll("button")].find(item => item.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!button) throw new Error("Missing button: " + ${JSON.stringify(text)});
    button.click();
    return true;
  })()`);
  const cardText = address => evaluate(`[...document.querySelectorAll("p")].find(p => p.textContent.includes(${JSON.stringify(address)}))?.textContent || ""`);

  await evaluate(`(() => {
    localStorage.setItem("enquote_local_session_email", "smoke.test@enphaseenergy.com");
    window.dispatchEvent(new CustomEvent("enquote_user_session_changed"));
    (window.__smokeCollections ||= {}).fsts = [
      {id: "fst-sa", name: "Smoke San Antonio", is_active: true, home_address: ${JSON.stringify(SAN_ANTONIO)}, shipping_address: "", state: "TX"},
      {id: "fst-unknown", name: "Smoke Unknown", is_active: true, home_address: ${JSON.stringify(UNKNOWN)}, shipping_address: "", state: "TX"}
    ];
    location.hash = "#/ResourcePlanner";
    return true;
  })()`);
  await waitFor(`[...document.querySelectorAll('[role="tab"]')].some(tab => tab.textContent.includes("FST Roster"))`, "Resource Planner tabs");
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.includes("FST Roster"));
    tab.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
    tab.click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes(${JSON.stringify(SAN_ANTONIO)})`, "seeded roster cards");
  assert.match(await cardText(SAN_ANTONIO), /Not checked/, "unlocated address is marked Not checked");

  await clickButton("Check locations");
  await waitFor(`document.body.innerText.includes("Checked 2 FSTs")`, "bulk check summary");
  await waitFor(`/ZIP only/.test([...document.querySelectorAll("p")].find(p => p.textContent.includes(${JSON.stringify(SAN_ANTONIO)}))?.textContent || "")`, "ZIP-only badge");
  assert.match(await cardText(UNKNOWN), /Not found/, "unknown address is marked Not found");
  await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Needs pin (2)"))`, "needs-pin count");

  await clickButton("Needs pin");
  await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Show all")`, "needs-pin filter on");
  // Roster order is preserved, so the first edit button belongs to the San Antonio FST.
  await evaluate(`document.querySelector("button svg.lucide-pencil").closest("button").click(); true`);
  await waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, "edit dialog");
  await waitFor(`document.querySelector('[role="dialog"]').innerText.includes("ZIP only")`, "dialog shows ZIP-only status");

  await waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => /Set pin on map|Hide map/.test(b.textContent))`, "pin button");
  const mapOpen = await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes("Hide map"))`);
  if (!mapOpen) await clickButton("Set pin on map", `document.querySelector('[role="dialog"]')`);
  await waitFor(`Boolean(document.querySelector('[role="dialog"] .leaflet-container'))`, "map renders", 150);
  await evaluate(`(() => {
    const input = document.querySelector('[role="dialog"] input[placeholder^="Or paste coordinates"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "29.528261, -98.694884");
    input.dispatchEvent(new Event("input", {bubbles: true}));
    return true;
  })()`);
  await sleep(100);
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === "Use").click(); true`);
  await waitFor(`document.querySelector('[role="dialog"]').innerText.includes("29.52826, -98.69488")`, "pinned coordinates shown")
    .catch(async (error) => { throw new Error(`${error.message}\n--- dialog ---\n${await evaluate(`document.querySelector('[role="dialog"]').innerText`)}`); });
  await waitFor(`Boolean(document.querySelector('[role="dialog"] .leaflet-marker-icon'))`, "pin marker");

  await clickButton("Save Changes", `document.querySelector('[role="dialog"]')`);
  await waitFor(`!document.querySelector('[role="dialog"]')`, "dialog closes after save", 150);
  await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Show all")`, "filter still on");
  await clickButton("Show all");
  await waitFor(`/Pinned/.test([...document.querySelectorAll("p")].find(p => p.textContent.includes(${JSON.stringify(SAN_ANTONIO)}))?.textContent || "")`, "roster shows Pinned badge");
  await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Needs pin (1)"))`, "needs-pin count drops to 1");
  const saved = await evaluate(`JSON.stringify(window.__smokeCollections.fsts.find(f => f.id === "fst-sa").home_geo)`);
  const geo = JSON.parse(saved);
  assert.equal(geo.precision, "pinned");
  assert.equal(geo.address, SAN_ANTONIO);
  assert.equal(geo.lat, 29.528261);
  assert.equal(geo.pinnedBy, "smoke.test@enphaseenergy.com");
  console.log("ok   Resource Planner: location check, needs-pin filter, map pin by coordinates, save");
}

module.exports = {runResourcePlanner};
