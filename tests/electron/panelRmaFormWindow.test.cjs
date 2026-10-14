const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {validatePanelFormUrl, createPanelRmaFormWindow} = require("../../electron/panelRmaFormWindow.cjs");

test("manufacturer forms only accept public HTTPS URLs without embedded credentials", () => {
  assert.equal(validatePanelFormUrl("https://manufacturer.example/claim"), "https://manufacturer.example/claim");
  for (const url of ["http://manufacturer.example", "file:///C:/secret", "javascript:alert(1)", "https://user:pass@manufacturer.example",
    "https://localhost", "https://127.0.0.1", "https://192.168.1.1", "https://device.local", "https://[::1]"]) {
    assert.throws(() => validatePanelFormUrl(url));
  }
});

test("manufacturer windows are isolated and their redirects/popups cannot access the desktop bridge", async () => {
  const created = [];
  class Window extends EventEmitter {
    constructor(options) {super();this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn => {this.popup=fn;};created.push(this);}
    async loadURL(url) {this.url=url;}
    isDestroyed() {return false;}
    close() {this.closed=true;this.emit("closed");}
  }
  let email = "user@example.com";
  const instance = createPanelRmaFormWindow({BrowserWindow:Window, session:{fromPartition:() => ({setPermissionRequestHandler(){}})},
    getEmail:() => email,getMainWindow:() => null});
  await instance.open("https://manufacturer.example/claim");
  assert.equal(created[0].options.webPreferences.nodeIntegration,false);
  assert.equal(created[0].options.webPreferences.sandbox,true);
  assert.equal(created[0].options.webPreferences.preload,undefined);
  assert.equal(created[0].popup({url:"file:///C:/secret"}).action,"deny");
  assert.equal(created[0].popup({url:"https://login.example/auth"}).action,"allow");
  let prevented=false;
  created[0].webContents.emit("will-navigate",{preventDefault(){prevented=true;}},"http://insecure.example");
  assert.equal(prevented,true);
  email="another@example.com";
  await instance.open("https://manufacturer.example/claim");
  assert.equal(created[0].closed,true);
  instance.close();
  assert.equal(created[1].closed,true);
});
