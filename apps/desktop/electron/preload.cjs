// Plain JavaScript: a sandboxed preload cannot strip types (D-36).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("officeTown", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openFolder: (path) => ipcRenderer.invoke("open-folder", path),
  showWindow: () => ipcRenderer.invoke("show-window"),
  setTheme: (theme) => ipcRenderer.invoke("set-theme", theme),
  pathOf: (file) => webUtils.getPathForFile(file),
  showFile: (path) => ipcRenderer.invoke("show-file", path),
  openFile: (path) => ipcRenderer.invoke("open-file", path),
  capture: (area, width) => ipcRenderer.invoke("capture", area, width),
});
