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
  appVersion(): Promise<string>;
  // The version downloaded and waiting for a restart; null while there is none.
  updateReady(): Promise<string | null>;
  // Returns a function that stops listening.
  onUpdateReady(listener: (version: string) => void): () => void;
  // Asks first when agents are open; does nothing if the user cancels.
  restartToUpdate(): Promise<void>;
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
