import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, statSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "vite";

// The dev app (D-75): the UI rebuilds and the window reloads; a change to the shell or the core
// restarts the app, which restarts its core.
const DESKTOP = join(import.meta.dirname, "..");
const REPO = join(DESKTOP, "..", "..");
const SOURCES = [
  join(DESKTOP, "electron"),
  ...["contract", "harness", "service"].map((name) => join(REPO, "packages", name, "src")),
];
const SOURCE_FILE = /\.(ts|cjs)$/;
const RESTART_DELAY_MS = 300;
// Longer than the app gives its core to stop its agents (15 s), so a clean stop is never cut short.
const STOP_TIMEOUT_MS = 20_000;
// In Node, the electron package is the path of its binary.
const ELECTRON = createRequire(import.meta.url)("electron") as string;

let app: ChildProcess | undefined;
let restarting: Promise<void> = Promise.resolve();
let stopping = false;

function startApp(): void {
  const started = spawn(ELECTRON, [DESKTOP], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  started.on("exit", (code) => {
    // A restart starts the next app itself.
    if (app !== started || stopping) return;
    // Quitting from the tray ends the dev loop; a failed start waits for the next save.
    if (code === 0) {
      void stop();
      return;
    }
    app = undefined;
    console.log("The app stopped. Save a file to start it again.");
  });
  app = started;
}

function killTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGKILL");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => resolve());
  });
}

async function stopApp(): Promise<void> {
  const running = app;
  app = undefined;
  if (running === undefined || running.exitCode !== null) return;
  const exited = once(running, "exit");
  running.disconnect();
  const stopped = await Promise.race([
    exited.then(() => true),
    delay(STOP_TIMEOUT_MS, false, { ref: false }),
  ]);
  if (stopped || running.pid === undefined) return;
  console.log("The app did not stop, so it and everything it started are ended.");
  await killTree(running.pid);
  await exited;
}

function restart(files: string[]): void {
  restarting = restarting.then(async () => {
    if (stopping) return;
    console.log(`Restarting the app: ${files.join(", ")} changed.`);
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

function fingerprint(path: string): string | undefined {
  try {
    const { mtimeMs, size } = statSync(path);
    return `${mtimeMs}:${size}`;
  } catch {
    return undefined;
  }
}

// Windows also reports a file that was only read (its last-access time), so only a file whose
// time or size moved counts as a change.
function watchSources(onChange: (files: string[]) => void): void {
  const known = new Map<string, string | undefined>();
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  for (const folder of SOURCES) {
    for (const file of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
      if (SOURCE_FILE.test(file)) known.set(join(folder, file), fingerprint(join(folder, file)));
    }
    watch(folder, { recursive: true }, (_change, file) => {
      if (file === null || !SOURCE_FILE.test(file)) return;
      const path = join(folder, file);
      const now = fingerprint(path);
      if (known.get(path) === now) return;
      known.set(path, now);
      changed.add(file);
      clearTimeout(timer);
      timer = setTimeout(() => {
        onChange([...changed]);
        changed.clear();
      }, RESTART_DELAY_MS);
    });
  }
}

const built = await build({ configFile: join(DESKTOP, "vite.config.ts"), build: { watch: {} } });
if (!("close" in built)) throw new Error("Vite did not start watching the UI.");
const ui = built;
await new Promise<void>((resolve) => {
  ui.on("event", (event) => {
    if (event.code === "END") resolve();
  });
});

watchSources(restart);
startApp();
process.on("SIGINT", () => void stop());
