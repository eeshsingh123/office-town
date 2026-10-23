import { homedir } from "node:os";
import { join } from "node:path";

// Local, not roaming: the store is large and holds paths that only mean something on this machine.
// Development gets its own folder, so it runs next to the installed app and never touches its data (D-75).
export function defaultDataFolder(development: boolean): string {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(local, development ? "OfficeTown Dev" : "OfficeTown");
  }
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(data, development ? "office-town-dev" : "office-town");
}
