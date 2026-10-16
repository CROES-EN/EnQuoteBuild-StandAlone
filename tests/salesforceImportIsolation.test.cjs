const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");

test("case workspace downloads are not captured by report imports", () => {
  const partition = new EventEmitter();
  let otherDownloadEvents = 0;
  partition.on("will-download", () => {otherDownloadEvents++;});
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        userAgent: "Chrome/123 Electron/44",
        setUserAgent() {},
        setWindowOpenHandler() {}
      });
      windows.push(this);
    }
    loadURL() {}
    isDestroyed() { return false; }
    focus() {}
    close() { this.closed = true; }
  }
  const captured = [];
  const deleted = [];
  const fakeFs = {
    readFileSync: () => Buffer.from("header\nvalue"),
    unlinkSync: file => deleted.push(file)
  };
  const module = {exports: {}};
  const filename = path.resolve("electron/salesforceImport.cjs");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, Buffer, console,
    require: name => name === "electron" ? {BrowserWindow, session: {fromPartition: () => partition}}
      : name === "node:fs" ? fakeFs : require(name)
  });
  module.exports.openSalesforceReportWindow("https://enphase.lightning.force.com/report", value => captured.push(value));
  const report = windows[0];
  const workspaceItem = {getFilename() { throw new Error("Workspace download must not be inspected"); }};
  partition.emit("will-download", {}, workspaceItem, {});
  assert.equal(captured.length, 0);
  const reportItem = new EventEmitter();
  reportItem.getFilename = () => "report.csv";
  reportItem.setSavePath = file => { reportItem.savePath = file; };
  partition.emit("will-download", {}, reportItem, report.webContents);
  reportItem.emit("done", {}, "completed");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "report.csv");
  assert.equal(Buffer.from(captured[0].base64, "base64").toString(), "header\nvalue");
  assert.deepEqual(deleted, [reportItem.savePath]);
  const child = new BrowserWindow();
  report.webContents.emit("did-create-window", child);
  const popupItem = new EventEmitter();
  popupItem.getFilename = () => "workload.xlsx";
  popupItem.setSavePath = file => {popupItem.savePath = file;};
  partition.emit("will-download", {}, popupItem, child.webContents);
  assert.ok(popupItem.savePath, "report popup export bypasses Save As");
  popupItem.emit("done", {}, "completed");
  assert.equal(captured.length, 2);
  assert.equal(captured[1].name, "workload.xlsx");
  const pdf = {getFilename: () => "case.pdf", setSavePath() {throw new Error("PDF must not be imported");}};
  partition.emit("will-download", {}, pdf, child.webContents);
  child.webContents.emit("destroyed");
  const unrelated = {getFilename() {throw new Error("Closed popup must not be captured");}};
  partition.emit("will-download", {}, unrelated, child.webContents);
  assert.equal(otherDownloadEvents, 5, "opening report import preserves other session download listeners");
  module.exports.closeSalesforceReportWindow();
  assert.equal(report.closed, true);
  assert.equal(partition.listenerCount("will-download"), 1);
});
