import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

// Choices about the window itself, read by the shell before any page loads, so they live beside
// the shell and not in the core (D-111).
export interface DesktopPreferences {
  // Closing the window keeps agents running in the tray (D-34); off, closing quits.
  closeToTray: boolean;
  // The tray note is shown once, the first time closing hides the window.
  trayNoteShown: boolean;
  // A Mac user who said no to moving the app into Applications is not asked again.
  moveDeclined: boolean;
}

const DEFAULTS: DesktopPreferences = {
  closeToTray: true,
  trayNoteShown: false,
  moveDeclined: false,
};

const file = () => join(app.getPath("userData"), "desktop.json");

export function readPreferences(): DesktopPreferences {
  try {
    const saved = JSON.parse(readFileSync(file(), "utf8")) as Partial<DesktopPreferences>;
    return {
      closeToTray:
        typeof saved.closeToTray === "boolean" ? saved.closeToTray : DEFAULTS.closeToTray,
      trayNoteShown: saved.trayNoteShown === true,
      moveDeclined: saved.moveDeclined === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(preferences: DesktopPreferences): void {
  try {
    writeFileSync(file(), JSON.stringify(preferences));
  } catch (error) {
    console.error("Could not save the desktop preferences.", error);
  }
}

// Only the installed app on Windows and macOS: a development build would register Electron
// itself, and Linux has no login item here.
export const canOpenAtLogin = (): boolean =>
  app.isPackaged && (process.platform === "win32" || process.platform === "darwin");

export const opensAtLogin = (): boolean =>
  canOpenAtLogin() && app.getLoginItemSettings().openAtLogin;

// macOS 13 lists a new login item as waiting until the user allows it in System Settings.
export const openAtLoginNeedsApproval = (): boolean =>
  process.platform === "darwin" &&
  canOpenAtLogin() &&
  app.getLoginItemSettings().status === "requires-approval";

export function setOpenAtLogin(on: boolean): void {
  if (canOpenAtLogin()) app.setLoginItemSettings({ openAtLogin: on });
}
