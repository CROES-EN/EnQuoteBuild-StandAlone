const assert = require("node:assert/strict");
const {BrowserWindow, session} = require("electron");
const {createPanelRmaFormWindow} = require("../../electron/panelRmaFormWindow.cjs");

async function runPanelRmaWindow(parent) {
  const before = new Set(BrowserWindow.getAllWindows());
  let isolatedSession;
  const forms = createPanelRmaFormWindow({
    BrowserWindow, getMainWindow:() => parent, getEmail:() => "smoke@example.com",
    session:{fromPartition:partition => {
      isolatedSession = session.fromPartition(partition);
      isolatedSession.protocol.handle("https", () => new Response(
        '<!doctype html><title>Manufacturer test form</title><label>Case <input id="case"></label><button>Manual submit</button>',
        {headers:{"Content-Type":"text/html"}}
      ));
      return isolatedSession;
    }}
  });
  try {
    assert.deepEqual(await forms.open("https://manufacturer.example/claim"), {ok:true});
    const window = BrowserWindow.getAllWindows().find(item => !before.has(item));
    assert.ok(window, "Actual manufacturer BrowserWindow opens");
    const state = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('#case').value = "001234";
      return {value:document.querySelector('#case').value, bridge:typeof window.enquoteLocal,
        require:typeof require, url:location.href};
    })()`);
    assert.deepEqual(state, {value:"001234",bridge:"undefined",require:"undefined",url:"https://manufacturer.example/claim"});
    assert.notEqual(window.webContents.session, parent.webContents.session, "Manufacturer login session is separate");
    console.log("ok   Native manufacturer window: editable form, isolated session, no desktop bridge or Node access");
  } finally {
    forms.close();
    isolatedSession?.protocol.unhandle("https");
  }
}

module.exports = {runPanelRmaWindow};
