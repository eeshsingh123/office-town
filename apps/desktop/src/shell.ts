// What the desktop shell offers the page through its preload. In browser mode there is no shell,
// so every caller has a way to do without it.
interface ShellBridge {
  pickFolder(): Promise<string | null>;
  openFolder(path: string): Promise<void>;
  showWindow(): Promise<void>;
}

declare global {
  interface Window {
    officeTown?: ShellBridge;
  }
}

export const shell: ShellBridge | undefined = window.officeTown;
