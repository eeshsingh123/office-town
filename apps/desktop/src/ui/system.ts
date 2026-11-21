// The UI runs on the same machine as the core, so the browser's system is the user's. Every word or
// shortcut that differs by system comes from here.
const agent = navigator.userAgent;
const windows = agent.includes("Windows");

export const isMac = agent.includes("Mac");

export const systemName = windows ? "Windows" : isMac ? "macOS" : "Linux";

// "Ctrl N" or "⌘N".
export function shortcut(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl ${key}`;
}

// Option and an arrow move by word in a Mac's text, so Back and Forward use ⌘[ and ⌘] there.
export const backKeys = isMac ? "⌘[" : "Alt ←";
export const forwardKeys = isMac ? "⌘]" : "Alt →";

export function isBackOrForward(event: KeyboardEvent): "back" | "forward" | undefined {
  if (isMac) {
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return undefined;
    return event.key === "[" ? "back" : event.key === "]" ? "forward" : undefined;
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  return event.key === "ArrowLeft" ? "back" : event.key === "ArrowRight" ? "forward" : undefined;
}

export const terminalName = windows ? "PowerShell" : isMac ? "Terminal" : "a terminal";

export const showInFolder = isMac ? "Show in Finder" : "Show in folder";

// Where the app keeps running with its window closed.
export const trayName = isMac ? "menu bar" : "tray";
