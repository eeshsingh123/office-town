import { homedir } from "node:os";
import { join } from "node:path";

// Local, not roaming, on Windows: the store is large and holds paths that only mean something on
// this machine.
export function defaultDataFolder(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "OfficeTown");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "office-town");
}
