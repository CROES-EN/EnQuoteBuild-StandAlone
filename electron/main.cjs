const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { repositoryFor } = require("./repository.cjs");

let quoteRepository;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "EnQuote",
    backgroundColor: "#071426",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.openDevTools();

  if (app.isPackaged) {
    // When packaged we copy the renderer 'dist' into resources via extraResources.
    // Try resources/dist first (extraResources), then fallback to packaged dist path.
    const fs = require("node:fs");
    const resourceDist = path.join(process.resourcesPath, "dist", "index.html");
    const packagedDist = path.join(__dirname, "..", "dist", "index.html");
    if (fs.existsSync(resourceDist)) {
      mainWindow.loadFile(resourceDist);
    } else if (fs.existsSync(packagedDist)) {
      mainWindow.loadFile(packagedDist);
    } else {
      console.warn("Renderer index.html not found in resources/dist or packaged dist; attempting packaged path anyway.");
      mainWindow.loadFile(packagedDist);
    }
  } else if (process.env.ENQUOTE_REMOTE_URL) {
    mainWindow.loadURL(process.env.ENQUOTE_REMOTE_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost:5173") || url.startsWith("https://enquote.base44.app")) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  quoteRepository = repositoryFor(app.getPath("userData"));
  ipcMain.handle("quotes:list", () => quoteRepository.list());
  ipcMain.handle("quotes:get", (_event, id) => quoteRepository.get(id));
  ipcMain.handle("quotes:create", (_event, record) => quoteRepository.create(record));
  ipcMain.handle("quotes:update", (_event, id, changes) => quoteRepository.update(id, changes));
  ipcMain.handle("quotes:delete", (_event, id) => quoteRepository.remove(id));
  ipcMain.handle("quotes:bulkUpdate", (_event, updates) => quoteRepository.bulkUpdate(updates));
  ipcMain.handle("quotes:reset", () => quoteRepository.reset());
  ipcMain.handle("quotes:export", () => quoteRepository.exportData());
  ipcMain.handle("quotes:import", (_event, data) => quoteRepository.importData(data));
  ipcMain.handle("products:list", () => quoteRepository.listProducts());
  ipcMain.handle("products:create", (_event, record) => quoteRepository.createProduct(record));
  ipcMain.handle("products:update", (_event, id, changes) => quoteRepository.updateProduct(id, changes));
  ipcMain.handle("products:delete", (_event, id) => quoteRepository.deleteProduct(id));
  ipcMain.handle("collections:list", (_event, name) => quoteRepository.listCollection(name));
  ipcMain.handle("collections:create", (_event, name, record) => quoteRepository.createCollectionRecord(name, record));
  ipcMain.handle("collections:update", (_event, name, id, changes) => quoteRepository.updateCollectionRecord(name, id, changes));
  ipcMain.handle("collections:delete", (_event, name, id) => quoteRepository.deleteCollectionRecord(name, id));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});