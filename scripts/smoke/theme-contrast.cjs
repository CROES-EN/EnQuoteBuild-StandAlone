const assert = require("node:assert/strict");
const path = require("node:path");
const {buildSync} = require("esbuild");

async function runThemeContrast(win) {
  const root = path.resolve(__dirname, "..", "..");
  const source = `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {Button} from "@/components/ui/button";
    import {Dialog, DialogContent, DialogTitle} from "@/components/ui/dialog";
    import {AlertDialog, AlertDialogContent, AlertDialogTitle} from "@/components/ui/alert-dialog";
    import {Sheet, SheetContent, SheetTitle} from "@/components/ui/sheet";
    import {THEMES} from "@/features/theme/themes";
    import {buildCustomTheme} from "@/features/theme/customThemeBuilder";
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
    document.head.append(style);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:10000;padding:24px;background:hsl(var(--background))";
    document.body.append(host);
    const root = createRoot(host);
    window.__contrastThemes = [
      ...Object.values(THEMES).filter(theme => theme.id !== "custom"),
      ...["light","dark"].map(mode => ({id: "custom-" + mode, ...buildCustomTheme({mode, backgroundTint:"#ff00aa", primary:"#0000ff"})}))
    ];
    const families = ["red","rose","yellow","amber","orange","green","emerald","teal","cyan","sky","blue","purple","violet","fuchsia","pink","lime"];
    window.__contrastRender = mode => root.render(mode === "buttons" ?
      <div>
        <p data-contrast="inherited">Inherited text</p>
        <p className="text-slate-900" data-contrast="legacy-heading">Legacy heading</p>
        <div className="bg-white"><p className="text-slate-700" data-contrast="legacy-card">Legacy card</p></div>
        <Button data-contrast="primary">Primary</Button>
        <Button variant="destructive" data-contrast="destructive">Delete</Button>
        <Button variant="outline" data-contrast="outline">Show Duplicates</Button>
        <Button variant="ghost" data-contrast="ghost">Export CSV</Button>
        <Button variant="link" data-contrast="link">Link</Button>
        <a href="#contrast" className="text-primary" data-contrast="plain-link">Case number</a>
        <Button variant="ghost" className="text-primary" data-contrast="primary-ghost">Send</Button>
        <Button className="bg-indigo-600 text-white hover:bg-indigo-700" data-contrast="legacy-primary">Select</Button>
        <Button className="bg-warning text-warning-foreground hover:bg-warning/90" data-contrast="warning">Alerts selected</Button>
        {families.map(family => <Button key={family} variant="outline" className={"text-" + family + "-700 hover:bg-" + family + "-50"}
          data-contrast={family}>Action</Button>)}
        <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" data-contrast="rose-ghost">Clear Data</Button>
      </div>
      : mode === "dialog" ?
        <Dialog open><DialogContent><DialogTitle data-contrast="dialog-title">1 Matching Quote</DialogTitle></DialogContent></Dialog>
      : mode === "alert" ?
        <AlertDialog open><AlertDialogContent><AlertDialogTitle data-contrast="alert-title">Confirm action</AlertDialogTitle></AlertDialogContent></AlertDialog>
      : <Sheet open><SheetContent><SheetTitle data-contrast="sheet-title">Details</SheetTitle></SheetContent></Sheet>
    );
  `;
  const bundle = buildSync({
    stdin: {contents: source, loader: "jsx", resolveDir: root},
    bundle: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", alias: {"@": path.join(root, "src")},
    define: {"process.env.NODE_ENV": '"production"'}
  });
  await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
  const themes = await win.webContents.executeJavaScript("window.__contrastThemes");
  const settle = () => new Promise(resolve => setTimeout(resolve, 220));
  const measure = () => win.webContents.executeJavaScript(`(() => {
    const rgb = value => value.match(/[\\d.]+/g).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const background = element => {
      if (!element) return [255,255,255];
      return blend(rgb(getComputedStyle(element).backgroundColor), background(element.parentElement));
    };
    const luminance = color => color.slice(0,3).map(v => {
      const c = v / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i], 0);
    return [...document.querySelectorAll("[data-contrast], [role=dialog] button")].map(element => {
      const bg = background(element);
      const fg = blend(rgb(getComputedStyle(element).color), bg);
      const a = luminance(fg), b = luminance(bg);
      const rect = element.getBoundingClientRect();
      return {name: element.dataset.contrast || "close", ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05),
        color: getComputedStyle(element).color, background: bg, x: Math.round(rect.x+rect.width/2), y: Math.round(rect.y+rect.height/2)};
    });
  })()`);
  let checks = 0;
  for (const theme of themes) {
    await win.webContents.executeJavaScript(`(() => {
      const theme = ${JSON.stringify(theme)};
      document.documentElement.classList.toggle("dark", theme.isDark);
      for (const [key,value] of Object.entries(theme.variables)) document.documentElement.style.setProperty(key,value);
      window.__contrastRender("buttons");
    })()`);
    win.webContents.sendInputEvent({type: "mouseMove", x: 1390, y: 890});
    await settle();
    const states = await measure();
    assert.equal(states.length, 29, `${theme.id}: all button/text samples rendered`);
    for (const state of states) {
      assert.ok(state.ratio >= 4.5, `${theme.id} ${state.name}: ${state.ratio.toFixed(2)} (${state.color} on ${state.background})`);
      checks += 1;
      if (["primary", "primary-ghost", "destructive", "warning", "outline", "ghost", "legacy-primary", "rose-ghost", "orange"].includes(state.name)) {
        win.webContents.sendInputEvent({type: "mouseMove", x: state.x, y: state.y});
        await settle();
        const hovered = (await measure()).find(item => item.name === state.name);
        assert.ok(hovered.ratio >= 4.5, `${theme.id} hovered ${state.name}: ${hovered.ratio.toFixed(2)}`);
        checks += 1;
        win.webContents.sendInputEvent({type: "mouseMove", x: 1390, y: 890});
        await settle();
      }
    }
    for (const mode of ["dialog", "alert", "sheet"]) {
      await win.webContents.executeJavaScript(`window.__contrastRender(${JSON.stringify(mode)})`);
      await settle();
      const dialogStates = await measure();
      assert.ok(dialogStates.some(state => state.name === `${mode}-title`), `${theme.id}: ${mode} title rendered`);
      if (mode !== "alert") assert.ok(dialogStates.some(state => state.name === "close"), `${theme.id}: ${mode} close button rendered`);
      for (const state of dialogStates) {
        assert.ok(state.ratio >= 4.5, `${theme.id} ${mode} ${state.name}: ${state.ratio.toFixed(2)}`);
        checks += 1;
      }
    }
  }
  console.log(`ok   Theme contrast: ${checks} computed-style checks across ${themes.length} light/dark themes (minimum 4.5:1).`);
}

module.exports = {runThemeContrast};
