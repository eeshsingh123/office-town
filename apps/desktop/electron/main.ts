import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPENS_SAFELY, taskPageSchema } from "@office-town/contract";
import {
  app,
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Notification,
  nativeTheme,
  net,
  powerMonitor,
  session,
  shell,
  type Tray,
} from "electron";
import { setAppMenu } from "./app-menu.ts";
import { APP_ORIGIN, registerAppScheme, serveApp } from "./app-protocol.ts";
import { type CoreCommand, type CoreProcess, startCore } from "./core-process.ts";
import {
  becomeDevApp,
  quitWhenDisconnected,
  reloadOnRebuild,
  showDevIcon,
  startedByDevLoop,
} from "./dev-mode.ts";
import { pictureOfPage } from "./page-picture.ts";
import {
  canOpenAtLogin,
  openAtLoginNeedsApproval,
  opensAtLogin,
  readPreferences,
  savePreferences,
  setOpenAtLogin,
} from "./preferences.ts";
import { createTray } from "./tray.ts";
import { followUpdates, releasePage, type Updates, updatesInstall } from "./updates.ts";
import { createWindow, showWindow } from "./window.ts";

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const ICON = file("./icon.png");
// Its @2x twin beside it is picked up by name.
const TRAY_TEMPLATE = file("./iconTemplate.png");
const PRELOAD = file("./preload.cjs");
const UI_FOLDER = file("../dist");
// Installed, the core is plain JS outside the archive (D-75); otherwise the sources run (D-19).
const CORE_ENTRY = app.isPackaged
  ? join(process.resourcesPath, "core", "main.mjs")
  : file("../../../packages/service/src/main.ts");
const QUIT_CHECK_TIMEOUT_MS = 3000;
const APP_ID = app.isPackaged ? "town.office.desktop" : "town.office.desktop.development";

// The core runs on Electron's own Node, so users install no Node (D-34).
const coreCommand: CoreCommand = {
  executable: process.execPath,
  args: [CORE_ENTRY, "--stop-when-stdin-closes"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
};

let core: CoreProcess | undefined;
// Set while the core starts, so quitting then still stops it.
let coreStarting: Promise<CoreProcess> | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let updates: Updates | undefined;
let quitting = false;
// A Mac quits from the Dock as well as the menu; either way the user is asked first, unless they
// already agreed or the system is logging out or shutting down.
let quitAgreed = false;
let systemEnding = false;
let askingToQuit: Promise<void> | undefined;
let preferences = readPreferences();

if (!app.isPackaged) becomeDevApp();
if (startedByDevLoop()) quitWhenDisconnected();
registerAppScheme();
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => open());
  // The Dock icon reopens a window closed to the menu bar.
  app.on("activate", () => open());
  app.on("before-quit", stopCoreFirst);
  app.whenReady().then(start).catch(failToStart);
} else {
  app.quit();
}

async function start(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin") {
    setAppMenu({ openSettings, quit: () => void confirmQuit() });
    powerMonitor.on("shutdown", () => {
      systemEnding = true;
    });
    if (app.isPackaged && (await offerMoveToApplications())) return;
  }
  coreStarting = startCore(coreCommand, { onCrash });
  core = await coreStarting;
  coreStarting = undefined;
  if (quitting) return;
  serveApp(UI_FOLDER, () => {
    if (core === undefined) throw new Error("The core is not running.");
    return core.ready;
  });
  registerBridge();
  denyPagesPermissions();
  window = createWindow({
    icon: ICON,
    preload: PRELOAD,
    isQuitting: () => quitting,
    closeToTray: () => preferences.closeToTray,
    onHidden: noteTrayOnce,
    onQuit: () => void confirmQuit(),
  });
  if (!app.isPackaged) showDevIcon(window, APP_ID, ICON);
  tray = createTray(
    { icon: ICON, template: TRAY_TEMPLATE },
    { open, quit: () => void confirmQuit() },
  );
  if (!app.isPackaged) reloadOnRebuild(UI_FOLDER, () => window);
  if (app.isPackaged) {
    updates = followUpdates((version) => window?.webContents.send("update-ready", version));
  }
}

// The first time closing hides the window, say where the app went and how to change it.
function noteTrayOnce(): void {
  if (preferences.trayNoteShown || !Notification.isSupported()) return;
  preferences = { ...preferences, trayNoteShown: true };
  savePreferences(preferences);
  new Notification({
    title: `${app.getName()} is still running`,
    body: `Agents keep working in the ${process.platform === "darwin" ? "menu bar" : "tray"}. To quit when you close the window, change it in Settings.`,
    icon: ICON,
  }).show();
}

// An app run from Downloads or the disk image runs from a temporary place, so the first open
// offers to move it. Returns true when it is moving, as the app then opens again from there.
async function offerMoveToApplications(): Promise<boolean> {
  if (preferences.moveDeclined || app.isInApplicationsFolder()) return false;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: "Move Office Town to your Applications folder?",
    detail:
      "Run from a download or a disk image, macOS may forget its permissions. It opens again once moved.",
    buttons: ["Move to Applications", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) {
    preferences = { ...preferences, moveDeclined: true };
    savePreferences(preferences);
    return false;
  }
  quitAgreed = true;
  try {
    return app.moveToApplicationsFolder();
  } catch (error) {
    quitAgreed = false;
    const detail = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({
      type: "warning",
      message: "Office Town could not move.",
      detail,
    });
    return false;
  }
}

function open(): void {
  if (window !== undefined) showWindow(window);
}

function openSettings(): void {
  open();
  window?.webContents.send("open-settings");
}

function failToStart(error: unknown): void {
  const title = `${app.getName()} could not start`;
  const detail = error instanceof Error ? error.message : String(error);
  // The error box blocks the whole app until it is closed, so the dev loop could not stop it.
  if (startedByDevLoop()) console.error(`${title}: ${detail}`);
  else if (!quitting) dialog.showErrorBox(title, detail);
  app.exit(1);
}

async function onCrash(log: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "Office Town stopped working. Restart it to continue.",
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
  if (open === undefined)
    return "Office Town is not responding, so it can't tell which agents are still working.";
  return open === 1 ? "An agent is still working." : `${open} agents are still working.`;
}

const STOP_QUESTIONS = {
  quit: {
    detail: "Quitting stops your working agents. You can continue their work later.",
    button: "Quit",
  },
  update: {
    detail: "Restarting stops your working agents. You can continue their work after the update.",
    button: "Restart",
  },
};

// A core that does not answer must not stop the user from quitting: they are asked instead.
async function agreeToStopAgents(reason: keyof typeof STOP_QUESTIONS): Promise<boolean> {
  const open = await openAgents().catch((error: unknown) => {
    console.error("Could not count the open agents.", error);
    return undefined;
  });
  if (open === 0) return true;
  const { detail, button } = STOP_QUESTIONS[reason];
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: quitQuestion(open),
    detail,
    buttons: [button, "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

async function confirmQuit(): Promise<void> {
  askingToQuit ??= agreeToStopAgents("quit")
    .then((agreed) => {
      if (!agreed) return;
      quitAgreed = true;
      app.quit();
    })
    .finally(() => {
      askingToQuit = undefined;
    });
  return askingToQuit;
}

// The update installs only after the core has stopped its agents (D-75).
async function restartToUpdate(): Promise<void> {
  const waiting = updates;
  const version = waiting?.ready();
  if (waiting === undefined || version === undefined) return;
  // A build that cannot install the update itself opens its download page instead.
  if (!updatesInstall()) return shell.openExternal(releasePage(version));
  if (!(await agreeToStopAgents("update"))) return;
  quitAgreed = true;
  await stopCore();
  waiting.install();
  // If the updater cannot start the installer it does not quit, and the app would be left with no
  // window and no tray.
  app.quit();
}

// Every way of quitting passes here, so the core always gets to record its agents as interrupted.
function stopCoreFirst(event: Electron.Event): void {
  if (process.platform === "darwin" && !quitAgreed && !systemEnding) {
    event.preventDefault();
    void confirmQuit();
    return;
  }
  quitting = true;
  if (core === undefined && coreStarting === undefined) return;
  event.preventDefault();
  void stopCore().finally(() => app.quit());
}

async function stopCore(): Promise<void> {
  quitting = true;
  const stopping = core ?? (await coreStarting?.catch(() => undefined));
  core = undefined;
  tray?.destroy();
  window?.hide();
  await stopping?.stop();
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
  ipcMain.handle("picture-of-page", (event, url: unknown, width: unknown) => {
    fromApp(event);
    if (typeof url !== "string" || typeof width !== "number" || width <= 0) {
      throw new Error("A picture needs an address and a width.");
    }
    return pictureOfPage(url, width);
  });
  ipcMain.handle("show-window", (event) => {
    fromApp(event);
    open();
  });
  ipcMain.handle("app-version", (event) => {
    fromApp(event);
    return app.isPackaged ? app.getVersion() : `${app.getVersion()} dev`;
  });
  ipcMain.handle("update-ready", (event) => {
    fromApp(event);
    return updates?.ready() ?? null;
  });
  ipcMain.handle("update-status", (event) => {
    fromApp(event);
    return updates?.status() ?? null;
  });
  ipcMain.handle("check-for-updates", (event) => {
    fromApp(event);
    return updates?.check() ?? null;
  });
  ipcMain.handle("desktop-preferences", (event) => {
    fromApp(event);
    return {
      closeToTray: preferences.closeToTray,
      openAtLogin: opensAtLogin(),
      canOpenAtLogin: canOpenAtLogin(),
      openAtLoginNeedsApproval: openAtLoginNeedsApproval(),
      updatesInstall: updatesInstall(),
    };
  });
  ipcMain.handle("set-close-to-tray", (event, on: unknown) => {
    fromApp(event);
    if (typeof on !== "boolean") throw new Error("Expected on or off.");
    preferences = { ...preferences, closeToTray: on };
    savePreferences(preferences);
  });
  ipcMain.handle("set-open-at-login", (event, on: unknown) => {
    fromApp(event);
    if (typeof on !== "boolean") throw new Error("Expected on or off.");
    setOpenAtLogin(on);
    return opensAtLogin();
  });
  ipcMain.handle("restart-to-update", (event) => {
    fromApp(event);
    return restartToUpdate();
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
