import { BrowserWindow, nativeTheme, shell } from "electron";
import { APP_ORIGIN } from "./app-protocol.ts";

export interface WindowOptions {
  icon: string;
  preload: string;
  // Closing hides the window, so agents keep running in the tray, until the app is quitting.
  isQuitting: () => boolean;
}

export function createWindow({ icon, preload, isQuitting }: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    title: "Office Town",
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121211" : "#F7F7F5",
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
  // Links in agent text open in the user's browser; the window itself never leaves the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  void window.loadURL(`${APP_ORIGIN}/`);
  return window;
}

export function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
