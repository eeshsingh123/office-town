import { mkdirSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow, nativeImage } from "electron";

const DEV_NAME = "Office Town Dev";
const RELOAD_DELAY_MS = 300;

// Its own name, settings and single-instance lock, so it runs next to the installed app (D-75).
export function becomeDevApp(): void {
  app.setName(DEV_NAME);
  app.setPath("userData", join(app.getPath("appData"), DEV_NAME));
}

// Only `pnpm dev:app` starts the app with an IPC channel.
export function startedByDevLoop(): boolean {
  return process.send !== undefined;
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
// Ctrl+C reaches every process in a Windows console, and dying by it would skip stopping the core,
// so the dev loop alone decides when the app quits.
export function quitWhenDisconnected(): void {
  process.on("disconnect", () => app.quit());
  process.on("SIGINT", () => undefined);
}

// The dev app runs electron.exe, whose icon Windows shows and remembers for the app's ID; naming
// our own icon on the window wins over both.
export function showDevIcon(window: BrowserWindow, appId: string, png: string): void {
  if (process.platform !== "win32") return;
  const image = nativeImage.createFromPath(png);
  const { width, height } = image.getSize();
  const data = image.toPNG();
  // An .ico holding one PNG: a 6-byte header and a 16-byte entry before the picture.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width % 256, 6);
  header.writeUInt8(height % 256, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(data.length, 14);
  header.writeUInt32LE(header.length, 18);
  const folder = app.getPath("userData");
  mkdirSync(folder, { recursive: true });
  const ico = join(folder, "icon.ico");
  writeFileSync(ico, Buffer.concat([header, data]));
  window.setAppDetails({ appId, appIconPath: ico });
}
