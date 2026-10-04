import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { taskPageSchema } from "@office-town/contract";
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
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
  // The page reaches the core through `serveApp`, which reads `core` on every request, so its
  // event stream reconnects to the new core by itself.
  core = await startCore(coreCommand, { onCrash }).catch((error: unknown) => {
    failToStart(error);
    return undefined;
  });
}

async function runningAgents(): Promise<number> {
  if (core === undefined) return 0;
  const { url, token } = core.ready;
  const response = await net.fetch(`${url}/tasks?active=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const { tasks } = taskPageSchema.parse(await response.json());
  return tasks
    .flatMap((task) => task.sessions)
    .filter((session) => session.status === "starting" || session.status === "running").length;
}

async function confirmQuit(): Promise<void> {
  const running = await runningAgents();
  if (running > 0) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      message:
        running === 1 ? "An agent is still working." : `${running} agents are still working.`,
      detail: "Quitting stops them. They are marked interrupted and can be continued later.",
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
  ipcMain.handle("show-window", (event) => {
    fromApp(event);
    open();
  });
}
