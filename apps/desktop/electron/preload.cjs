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
  appVersion: () => ipcRenderer.invoke("app-version"),
  updateReady: () => ipcRenderer.invoke("update-ready"),
  onUpdateReady: (listener) => {
    const handler = (_event, version) => listener(version);
    ipcRenderer.on("update-ready", handler);
    return () => ipcRenderer.removeListener("update-ready", handler);
  },
  restartToUpdate: () => ipcRenderer.invoke("restart-to-update"),
});
