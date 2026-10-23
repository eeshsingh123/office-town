import { watch } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

const DEV_NAME = "Office Town Dev";
const RELOAD_DELAY_MS = 300;

// Its own name, settings and single-instance lock, so it runs next to the installed app (D-75).
export function becomeDevApp(): void {
  app.setName(DEV_NAME);
  app.setPath("userData", join(app.getPath("appData"), DEV_NAME));
}

// `pnpm dev:app` rebuilds the UI into this folder; a build writes many files, so the reload waits.
export function reloadOnRebuild(uiFolder: string, window: () => BrowserWindow | undefined): void {
  let timer: NodeJS.Timeout | undefined;
  watch(uiFolder, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => window()?.webContents.reload(), RELOAD_DELAY_MS);
  });
}

// How `pnpm dev:app` restarts the app: quitting stops the core first, so the next one finds its data
// free. An IPC channel, because on Windows the main process sees stdin closed from the start.
export function quitWhenDisconnected(): void {
  process.on("disconnect", () => app.quit());
}
