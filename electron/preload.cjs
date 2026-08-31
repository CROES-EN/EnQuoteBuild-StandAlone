const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("enquoteLocal", {
  quotes: {
    list: () => invoke("quotes:list"),
    get: id => invoke("quotes:get", id),
    create: record => invoke("quotes:create", record),
    update: (id, changes) => invoke("quotes:update", id, changes),
    delete: id => invoke("quotes:delete", id),
    bulkUpdate: updates => invoke("quotes:bulkUpdate", updates),
    reset: () => invoke("quotes:reset"),
    exportData: () => invoke("quotes:export"),
    importData: data => invoke("quotes:import", data)
  },
  products: {
    list: () => invoke("products:list"),
    create: record => invoke("products:create", record),
    update: (id, changes) => invoke("products:update", id, changes),
    delete: id => invoke("products:delete", id)
  },
  collections: {
    list: name => invoke("collections:list", name),
    create: (name, record) => invoke("collections:create", name, record),
    update: (name, id, changes) => invoke("collections:update", name, id, changes),
    delete: (name, id) => invoke("collections:delete", name, id)
  }
});
