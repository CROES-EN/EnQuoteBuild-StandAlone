const assert = require("node:assert/strict");
const path = require("node:path");
const {readFileSync} = require("node:fs");
const {buildSync} = require("esbuild");

async function runSopLinks(win) {
  const root = path.resolve(__dirname, "..", "..");
  for (const file of ["src\\pages\\SOPLibrary.jsx", "src\\components\\sop\\SopHistoryDialog.jsx", "src\\components\\sop\\SopFilePreview.jsx"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /<SopRichContent\b/, `${file} uses the shared link behavior`);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  }
  const opened = [];
  win.webContents.setWindowOpenHandler(({url}) => {
    opened.push(url);
    return {action: "deny"};
  });
  const before = win.webContents.getURL();
  const bundle = buildSync({
    stdin: {loader: "jsx", resolveDir: root, contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import SopRichContent from "@/components/sop/SopRichContent";
      const host = document.createElement("div");
      host.id = "sop-link-test";
      document.body.append(host);
      createRoot(host).render(<SopRichContent html={
        '<a id="external" href="https://example.invalid/login" target="_self"><strong>Portal login</strong></a>' +
        '<a id="top" href="https://example.invalid/top" target="_top">Top target</a>' +
        '<a id="section-link" href="#section">Jump to section</a><h2 id="section">Section</h2>' +
        '<a id="unsafe" href="javascript:alert(1)">Unsafe link</a><script>window.__unsafeSop=true</script>'
      } />);
    `},
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: {"@": path.join(root, "src")}, define: {"process.env.NODE_ENV": '"production"'}
  });
  await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
  await new Promise(resolve => setTimeout(resolve, 300));
  const links = await win.webContents.executeJavaScript(`(() => {
    const host = document.getElementById("sop-link-test");
    return [...host.querySelectorAll("a")].map(link => ({id:link.id, href:link.getAttribute("href"), target:link.target, rel:link.rel}));
  })()`);
  for (const id of ["external", "top"]) {
    const link = links.find(item => item.id === id);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    await win.webContents.executeJavaScript(`document.querySelector("#sop-link-test #${id}").click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(win.webContents.getURL(), before, "External link must not navigate EnQuote");
  }
  assert.deepEqual(opened, ["https://example.invalid/login", "https://example.invalid/top"]);
  assert.equal(links.find(item => item.id === "unsafe").href, null, "Unsafe URL is sanitized");
  assert.equal(await win.webContents.executeJavaScript("Boolean(window.__unsafeSop)"), false);
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector("#sop-link-test #section").scrollIntoView = () => { window.__sopSectionScrolled = true; };
    document.querySelector("#sop-link-test #section-link").click();
  })()`);
  assert.equal(await win.webContents.executeJavaScript("window.__sopSectionScrolled"), true);
  assert.equal(win.webContents.getURL(), before, "Section links must not change the app route");
  assert.equal(opened.length, 2);
  console.log("ok   SOP links: separate-window navigation, preserved app URL, in-page sections, and sanitized content.");
}

module.exports = {runSopLinks};
