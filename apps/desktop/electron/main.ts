import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENS_SAFELY, taskPageSchema } from "@office-town/contract";
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeTheme,
  net,
  session,
  shell,
  type Tray,
} from "electron";
import { APP_ORIGIN, registerAppScheme, serveApp } from "./app-protocol.ts";
import { type CoreCommand, type CoreProcess, startCore } from "./core-process.ts";
import { createTray } from "./tray.ts";
import { createWindow, showWindow } from "./window.ts";

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const ICON = file("./icon.png");
const PRELOAD = file("./preload.cjs");
const UI_FOLDER = file("../dist");
const CORE_ENTRY = file("../../../packages/service/src/main.ts");
const QUIT_CHECK_TIMEOUT_MS = 3000;

// The core runs on Electron's own Node, so users install no Node (D-34).
const coreCommand: CoreCommand = {
  executable: process.execPath,
  args: [CORE_ENTRY, "--stop-when-stdin-closes"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
};

let core: CoreProcess | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

registerAppScheme();
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => open());
  app.on("before-quit", stopCoreFirst);
  app.whenReady().then(start).catch(failToStart);
} else {
  app.quit();
}

async function start(): Promise<void> {
  app.setAppUserModelId("town.office.desktop");
  core = await startCore(coreCommand, { onCrash });
  serveApp(UI_FOLDER, () => {
    if (core === undefined) throw new Error("The core is not running.");
    return core.ready;
  });
  registerBridge();
  denyPagesPermissions();
  window = createWindow({ icon: ICON, preload: PRELOAD, isQuitting: () => quitting });
  tray = createTray(ICON, { open, quit: () => void confirmQuit() });
}

function open(): void {
  if (window !== undefined) showWindow(window);
}

function failToStart(error: unknown): void {
  dialog.showErrorBox(
    "Office Town could not start",
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
}

async function onCrash(log: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "The Office Town core stopped unexpectedly.",
    detail: log.trim().split("\n").slice(-12).join("\n"),
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) {
    core = undefined;
    app.quit();
    return;
  }
  // `serveApp` reads `core` on every request, so the page's event stream reconnects by itself.
  core = await startCore(coreCommand, { onCrash }).catch((error: unknown) => {
    failToStart(error);
    return undefined;
  });
}

// Includes agents done with their turn and waiting for another message.
async function openAgents(): Promise<number> {
  if (core === undefined) return 0;
  const { url, token } = core.ready;
  const response = await net.fetch(`${url}/tasks?active=true`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(QUIT_CHECK_TIMEOUT_MS),
  });
  const { tasks } = taskPageSchema.parse(await response.json());
  return tasks
    .flatMap((task) => task.sessions)
    .filter((session) => session.status === "starting" || session.status === "running").length;
}

function quitQuestion(open: number | undefined): string {
  if (open === undefined) return "The core is not answering, so open agents cannot be counted.";
  return open === 1 ? "An agent is still open." : `${open} agents are still open.`;
}

// A core that does not answer must not stop the user from quitting: they are asked instead.
async function confirmQuit(): Promise<void> {
  const open = await openAgents().catch((error: unknown) => {
    console.error("Could not count the open agents.", error);
    return undefined;
  });
  if (open !== 0) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: quitQuestion(open),
      detail: "Quitting stops any open agent. It is marked interrupted and can be continued later.",
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  app.quit();
}

// Every way of quitting passes here, so the core always gets to record its agents as interrupted.
function stopCoreFirst(event: Electron.Event): void {
  quitting = true;
  const stopping = core;
  if (stopping === undefined) return;
  event.preventDefault();
  core = undefined;
  tray?.destroy();
  window?.hide();
  void stopping.stop().finally(() => app.quit());
}

function fromApp(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) {
    throw new Error("Only the app's own page may call the shell.");
  }
}

// Pages agents made ask for nothing: no camera, microphone, location or notifications (M8).
function denyPagesPermissions(): void {
  const fromAppPage = (url: string) => url.startsWith(`${APP_ORIGIN}/`) || url === APP_ORIGIN;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback, details) =>
    callback(fromAppPage(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, _permission, origin) =>
    fromAppPage(origin),
  );
}

async function existingFile(path: unknown): Promise<string> {
  if (typeof path !== "string" || !(await stat(path)).isFile()) {
    throw new Error("Only an existing file can be opened.");
  }
  return path;
}

function registerBridge(): void {
  ipcMain.handle("pick-folder", async (event) => {
    fromApp(event);
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const picked =
      window === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle("open-folder", async (event, path: unknown) => {
    fromApp(event);
    // Only folders: opening a file would run whatever program the system pairs with it.
    if (typeof path !== "string" || !(await stat(path)).isDirectory()) {
      throw new Error("Only a folder can be opened.");
    }
    const error = await shell.openPath(path);
    if (error !== "") throw new Error(error);
  });
  ipcMain.handle("show-file", async (event, path: unknown) => {
    fromApp(event);
    shell.showItemInFolder(await existingFile(path));
  });
  ipcMain.handle("open-file", async (event, path: unknown) => {
    fromApp(event);
    const file = await existingFile(path);
    // An agent may have written it, so only kinds that cannot run when opened (M8).
    if (!OPENS_SAFELY.has(extname(file).slice(1).toLowerCase())) {
      throw new Error(
        "The app opens only documents, pictures and media. Open this from its folder.",
      );
    }
    const error = await shell.openPath(file);
    if (error !== "") throw new Error(error);
  });
  // A picture of part of the window: a marked spot, or a result's picture (M8).
  ipcMain.handle("capture", async (event, area: unknown, width: unknown) => {
    fromApp(event);
    const { x, y, width: w, height: h } = (area ?? {}) as Record<string, unknown>;
    if (![x, y, w, h].every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("A capture needs an area.");
    }
    const zoom = event.sender.getZoomFactor();
    const rect = [x, y, w, h].map((value) => Math.round((value as number) * zoom));
    const [left = 0, top = 0, across = 1, down = 1] = rect;
    const image = await event.sender.capturePage({ x: left, y: top, width: across, height: down });
    const target = typeof width === "number" && width > 0 ? width : undefined;
    const sized =
      target !== undefined && image.getSize().width > target
        ? image.resize({ width: target })
        : image;
    return sized.toPNG();
  });
  ipcMain.handle("show-window", (event) => {
    fromApp(event);
    open();
  });
  // The window frame follows the theme the user picks in the app.
  ipcMain.handle("set-theme", (event, theme: unknown) => {
    fromApp(event);
    if (theme !== "light" && theme !== "dark" && theme !== "system") {
      throw new Error("Unknown theme.");
    }
    nativeTheme.themeSource = theme;
  });
}
