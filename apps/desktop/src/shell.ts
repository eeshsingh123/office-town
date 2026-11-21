// In browser mode there is no shell, so every caller has a way to do without it.
interface ShellBridge {
  pickFolder(): Promise<string | null>;
  openFolder(path: string): Promise<void>;
  showWindow(): Promise<void>;
  setTheme(theme: "light" | "dark" | "system"): Promise<void>;
  // Where a dropped file or folder is on disk.
  pathOf(file: File): string;
  showFile(path: string): Promise<void>;
  // Refused for a file that would run when opened.
  openFile(path: string): Promise<void>;
  // A PNG of that part of the window, in page pixels, at most `width` wide.
  capture(area: Area, width?: number): Promise<Uint8Array>;
  // A PNG of a local page the user is not looking at, at most `width` wide.
  pictureOfPage(url: string, width: number): Promise<Uint8Array>;
  appVersion(): Promise<string>;
  // The version downloaded and waiting for a restart; null while there is none.
  updateReady(): Promise<string | null>;
  // Returns a function that stops listening.
  onUpdateReady(listener: (version: string) => void): () => void;
  // Asks first when agents are open; does nothing if the user cancels. A build that cannot install
  // updates opens the download page instead.
  restartToUpdate(): Promise<void>;
  // The app menu's Settings on a Mac. Returns a function that stops listening.
  onOpenSettings(listener: () => void): () => void;
  // Null in the development app, which does not update itself.
  updateStatus(): Promise<UpdateStatus | null>;
  checkForUpdates(): Promise<UpdateStatus | null>;
  desktopPreferences(): Promise<DesktopPreferences>;
  setCloseToTray(on: boolean): Promise<void>;
  // Returns whether it is now on.
  setOpenAtLogin(on: boolean): Promise<boolean>;
  setKeepAwake(on: boolean): Promise<void>;
}

// As the shell's updates.ts says it.
export type UpdateStatus =
  | { state: "unknown" }
  | { state: "checking" }
  | { state: "latest" }
  | { state: "downloading"; version: string }
  | { state: "ready"; version: string }
  | { state: "available"; version: string }
  | { state: "failed" };

export interface DesktopPreferences {
  closeToTray: boolean;
  // While agents work, on battery too (D-123).
  keepAwake: boolean;
  openAtLogin: boolean;
  // Only the installed app on Windows and macOS.
  canOpenAtLogin: boolean;
  // On a Mac, until the user allows it in System Settings.
  openAtLoginNeedsApproval: boolean;
  // False for an unsigned Mac build, which only says an update is ready.
  updatesInstall: boolean;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    officeTown?: ShellBridge;
  }
}

export const shell: ShellBridge | undefined = window.officeTown;
