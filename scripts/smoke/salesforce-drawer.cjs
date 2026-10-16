const {BrowserWindow, WebContentsView, session, ipcMain, nativeImage, clipboard} = require("electron");
const {createSalesforceWorkspace} = require("../../electron/salesforceWorkspace.cjs");
const {createSalesforceAttachment} = require("../../electron/salesforceAttachment.cjs");

async function installSalesforceDrawerFixture() {
  const attachment = createSalesforceAttachment({nativeImage, clipboard, shell: {showItemInFolder() {}}});
  const partition = session.fromPartition("persist:enquote-salesforce");
  await partition.protocol.handle("https", () => new Response(
    `<!doctype html><html><body style="background:#eef6ff"><h1>Salesforce fixture</h1><input aria-label="Case notes" />
      <div role="tabpanel" id="fixture-case">
        <records-record-layout-block style="display:block">
          <records-record-layout-item style="display:block">
            <div class="slds-form-element"><span class="test-id__field-label">Case Number</span></div>
            <div class="test-id__field-value"><lightning-formatted-text style="display:contents">456</lightning-formatted-text><button>Edit Case Number</button></div>
          </records-record-layout-item>
          <records-record-layout-item style="display:block">
            <div class="slds-form-element"><span class="test-id__field-label">Contact Name</span></div>
            <div class="test-id__field-value"><a href="/contact" role="button">Jane Doe<span class="slds-assistive-text"> Preview</span></a><button>Open Contact Preview</button></div>
          </records-record-layout-item>
        </records-record-layout-block>
        <records-record-layout-block style="display:block">
          <div class="slds-form-element"><span class="test-id__field-label">Enlighten Site ID</span><lightning-formatted-text>123</lightning-formatted-text></div>
        </records-record-layout-block>
      </div>
      <div style="display:none" class="forceRecordLayout">
        <div class="slds-form-element"><span class="test-id__field-label">Case Number</span><lightning-formatted-text>999</lightning-formatted-text></div>
        <div class="slds-form-element"><span class="test-id__field-label">Contact Name</span><lightning-formatted-text>Wrong Hidden Contact</lightning-formatted-text></div>
      </div>
    </body></html>`,
    {headers: {"content-type": "text/html"}}
  ));
  const workspace = createSalesforceWorkspace({
    WebContentsView, session,
    onStateChanged: stateFor => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("smoke:salesforce-state", {...stateFor(window), attachment: attachment.state("smoke")});
      }
    }
  });
  ipcMain.handle("smoke:salesforce-action", async (event, action, bounds) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (action === "inspect" || action === "scan") {
      try {return {ok: true, context: await workspace.inspect(owner, {retry: action === "inspect"})};}
      catch (error) {return {ok: false, error: error.message};}
    }
    if (action === "toggle") workspace.toggle(owner);
    else if (action === "hide") workspace.hide(owner);
    else if (action === "bounds") workspace.setBounds(bounds, owner);
    else if (action === "reload") workspace.reload(owner);
    else if (action !== "state") throw new Error("Unknown smoke Salesforce action.");
    return {ok: true, ...workspace.state(owner), attachment: attachment.state("smoke")};
  });
  ipcMain.handle("smoke:salesforce-open", (event, url) => {
    workspace.open(url, BrowserWindow.fromWebContents(event.sender));
    return {ok: true};
  });
  ipcMain.handle("smoke:salesforce-attachment", async (event, action, payload) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (action === "clear") {
      if (!workspace.state(owner).visible) throw new Error("Only the active Salesforce panel can clear its quote PDF.");
      attachment.clear("smoke");
      workspace.notify();
      return {ok: true};
    }
    if (action === "copy-email") {
      await attachment.copyEmail("smoke");
      return {ok: true};
    }
    if (action !== "prepare") throw new Error("Only preparation is exercised by this UI fixture.");
    if (payload.context) {
      const current = await workspace.inspect(owner, {retry: false});
      if (["caseNumber", "siteId", "contactName"].some(key => current[key] !== payload.context[key])) {
        return {ok: false, error: "The Salesforce case changed before the PDF was saved."};
      }
    }
    const revision = workspace.state(owner).pageRevision;
    const result = await attachment.prepare(payload, "smoke", () => !payload.context ||
      (workspace.state(owner).visible && workspace.state(owner).pageRevision === revision));
    attachment.drag({startDrag: item => {
      if (item.icon.isEmpty()) throw new Error("PDF native drag icon is empty.");
      if (!require("node:fs").existsSync(item.file)) throw new Error("Prepared PDF is missing.");
    }}, "smoke");
    if (payload.context) workspace.notify();
    else workspace.open(undefined, owner);
    return {ok: true, attachment: result};
  });
  return {close() {workspace.close(); attachment.clear();}};
}

module.exports = {installSalesforceDrawerFixture};
