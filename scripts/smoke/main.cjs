// Renderer smoke test: loads the BUILT UI (dist/) in a hidden Electron window with a stand-in
// bridge and visits every page, failing on any crash, error screen, console error or blank page.
// Run via `npm run smoke` (scripts/smoke-test.cjs starts this under Electron).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const distIndex = path.join(path.resolve(process.env.ENQUOTE_SMOKE_DIST || path.join(root, "dist")), "index.html");
const PAGE_SETTLE_MS = 2500;
// Pages that need a record id in the URL to mean anything.
const SKIP_PAGES = new Set(["QuoteDetails", "EditQuote", "QuoteOverview"]);
// Console noise that is environmental, not an app bug (no network in the test window).
const IGNORED_CONSOLE = [/Failed to load resource/i, /net::ERR/i, /ERR_FILE_NOT_FOUND.*favicon/i, /Autofill/i];

function pageNames() {
  return fs.readdirSync(path.join(root, "src", "pages"))
    .filter((name) => /^[A-Z][A-Za-z]+\.jsx$/.test(name))
    .map((name) => name.replace(/\.jsx$/, ""))
    .filter((name) => !SKIP_PAGES.has(name));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  if (!fs.existsSync(distIndex)) throw new Error("dist/index.html is missing - run the build first.");
  app.setPath("userData", process.env.ENQUOTE_SMOKE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "enquote-smoke-")));

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"), contextIsolation: false, sandbox: false, nodeIntegration: false,
      backgroundThrottling: !process.argv.includes("--console-only"),
      additionalArguments: process.argv.includes("--console-only") ? ["--console-only"] : []
    }
  });

  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    const { level, message } = event;
    if ((level === "error" || level === 3) && !IGNORED_CONSOLE.some((pattern) => pattern.test(message))) consoleErrors.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) => consoleErrors.push(`renderer process gone: ${details.reason}`));

  await win.loadFile(distIndex);
  await sleep(PAGE_SETTLE_MS);

  const failures = [];
  const pages = process.argv.includes("--case-work-only") || process.argv.includes("--stability-only") || process.argv.includes("--sop-sections-only") || process.argv.includes("--retro-only") || process.argv.includes("--console-only") ? [] : ["Dashboard", ...pageNames().filter((name) => name !== "Dashboard")];
  for (const page of pages) {
    consoleErrors.length = 0;
    await win.webContents.executeJavaScript(`window.__smokeErrors.length = 0; location.hash = "#/${page}"; true`);
    await sleep(PAGE_SETTLE_MS);
    const state = await win.webContents.executeJavaScript(`(() => {
      const root = document.getElementById("root");
      const text = document.body.innerText || "";
      return {
        children: root ? root.childElementCount : 0,
        errorScreen: /Something went wrong/i.test(text),
        signInScreen: /Sign in to EnQuote|Setting up your account/i.test(text),
        notFound: /page not found/i.test(text),
        textLength: text.trim().length,
        pageErrors: window.__smokeErrors.slice()
      };
    })()`);

    const problems = [];
    if (!state.children || state.textLength === 0) problems.push("blank page");
    if (state.errorScreen) problems.push('shows "Something went wrong"');
    if (state.signInScreen) problems.push("shows sign-in/setup instead of the requested page");
    if (state.notFound) problems.push("shows page-not-found");
    state.pageErrors.forEach((message) => problems.push(message));
    consoleErrors.forEach((message) => problems.push(`console: ${message}`));

    console.log(`${problems.length ? "FAIL" : "ok  "} ${page}${problems.length ? ` - ${[...new Set(problems)].join(" | ").slice(0, 300)}` : ""}`);
    if (problems.length) failures.push(page);
  }

  if (pages.length) console.log(`\n${pages.length - failures.length}/${pages.length} pages rendered cleanly.`);
  if (!failures.length && process.argv.includes("--sop-sections-only")) {
    await require("./sop-sections.cjs").runSopSections(win);
  }
  if (!failures.length && (process.argv.includes("--stability") || process.argv.includes("--stability-only"))) {
    await require("./stability.cjs").runStability(win);
    if (consoleErrors.length) throw new Error(`Stability console errors: ${[...new Set(consoleErrors)].join(" | ")}`);
  }
  if (!failures.length && process.argv.includes("--retro-only")) {
    await require("./Base44_DTO.cjs").runRetro(win);
  }
  if (!failures.length && process.argv.includes("--console-only")) {
    await require("./developer-console.cjs").runDeveloperConsole(win);
    if (consoleErrors.length) throw new Error(`Developer Console errors: ${[...new Set(consoleErrors)].join(" | ")}`);
  }
  if (!failures.length && process.argv.includes("--case-work-only")) {
    await require("./case-work.cjs").runCaseWork(win);
    if (consoleErrors.length) throw new Error(`Case-work console errors: ${[...new Set(consoleErrors)].join(" | ")}`);
  }
  return failures.length === 0 ? 0 : 1;
}

app.whenReady()
  .then(run)
  .then((code) => app.exit(code))
  .catch((error) => {
    console.error("Smoke test could not run:", error.stack || error.message);
    app.exit(2);
  });
