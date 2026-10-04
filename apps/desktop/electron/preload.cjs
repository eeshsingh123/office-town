// Plain JavaScript: a sandboxed preload cannot strip types (D-36).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("officeTown", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openFolder: (path) => ipcRenderer.invoke("open-folder", path),
  showWindow: () => ipcRenderer.invoke("show-window"),
});
