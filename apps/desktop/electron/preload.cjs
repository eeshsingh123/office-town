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
  pictureOfPage: (url, width) => ipcRenderer.invoke("picture-of-page", url, width),
  appVersion: () => ipcRenderer.invoke("app-version"),
  updateReady: () => ipcRenderer.invoke("update-ready"),
  onUpdateReady: (listener) => {
    const handler = (_event, version) => listener(version);
    ipcRenderer.on("update-ready", handler);
    return () => ipcRenderer.removeListener("update-ready", handler);
  },
  restartToUpdate: () => ipcRenderer.invoke("restart-to-update"),
  onOpenSettings: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("open-settings", handler);
    return () => ipcRenderer.removeListener("open-settings", handler);
  },
  updateStatus: () => ipcRenderer.invoke("update-status"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  desktopPreferences: () => ipcRenderer.invoke("desktop-preferences"),
  setCloseToTray: (on) => ipcRenderer.invoke("set-close-to-tray", on),
  setOpenAtLogin: (on) => ipcRenderer.invoke("set-open-at-login", on),
});
