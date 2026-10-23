import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { build } from "vite";

// The dev app (D-75): the UI rebuilds and the window reloads; a change to the shell or the core
// restarts the app, which restarts its core.
const DESKTOP = join(import.meta.dirname, "..");
const REPO = join(DESKTOP, "..", "..");
const SOURCES = [
  join(DESKTOP, "electron"),
  ...["contract", "harness", "service"].map((name) => join(REPO, "packages", name, "src")),
];
const RESTART_DELAY_MS = 300;
// In Node, the electron package is the path of its binary.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

let app: ChildProcess | undefined;
let restarting: Promise<void> = Promise.resolve();
let stopping = false;

function startApp(): void {
  const started = spawn(ELECTRON, [DESKTOP], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  started.on("exit", () => {
    // Quitting from the tray ends the dev loop too; a restart starts the next app itself.
    if (app === started && !stopping) void stop();
  });
  app = started;
}

async function stopApp(): Promise<void> {
  const running = app;
  app = undefined;
  if (running === undefined || running.exitCode !== null) return;
  const exited = once(running, "exit");
  running.disconnect();
  await exited;
}

function restart(): void {
  restarting = restarting.then(async () => {
    if (stopping) return;
    console.log("Restarting the app…");
    await stopApp();
    startApp();
  });
}

async function stop(): Promise<void> {
  stopping = true;
  await stopApp();
  await ui.close();
  process.exit(0);
}

const built = await build({ configFile: join(DESKTOP, "vite.config.ts"), build: { watch: {} } });
if (!("close" in built)) throw new Error("Vite did not start watching the UI.");
const ui = built;
await new Promise<void>((resolve) => {
  ui.on("event", (event) => {
    if (event.code === "END") resolve();
  });
});

let timer: NodeJS.Timeout | undefined;
for (const folder of SOURCES) {
  watch(folder, { recursive: true }, (_change, file) => {
    if (file === null || !/\.(ts|cjs)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(restart, RESTART_DELAY_MS);
  });
}
startApp();
process.on("SIGINT", () => void stop());
