import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { APP_ORIGIN } from "./app-protocol.ts";
import { addTextMenu } from "./context-menu.ts";

export interface WindowOptions {
  icon: string;
  preload: string;
  isQuitting: () => boolean;
  // Closing hides the window, so agents keep running in the tray (D-34), unless the user chose in
  // Settings that closing quits (D-111).
  closeToTray: () => boolean;
  onHidden: () => void;
  onQuit: () => void;
}

export function createWindow({
  icon,
  preload,
  isQuitting,
  closeToTray,
  onHidden,
  onQuit,
}: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    title: app.getName(),
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
  // The page has one fixed title; the window keeps the app name, which tells the dev app apart.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    if (!closeToTray()) {
      onQuit();
      return;
    }
    window.hide();
    onHidden();
  });
  // Links in agent text open in the user's browser; the window itself never leaves the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  addTextMenu(window);
  void window.loadURL(`${APP_ORIGIN}/`);
  return window;
}

export function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
