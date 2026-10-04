import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { type CoreReady, coreReadySchema } from "@office-town/contract";

const STOP_TIMEOUT_MS = 15_000;
const LOG_TAIL_CHARACTERS = 4000;

export interface CoreCommand {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface CoreOptions {
  // Called when the core exits without being asked to, with the end of what it logged.
  onCrash: (log: string) => void;
  stopTimeoutMs?: number;
}

export interface CoreProcess {
  ready: CoreReady;
  // Resolves once the core has exited.
  stop(): Promise<void>;
}

export class CoreStartError extends Error {
  constructor(log: string) {
    super(log.trim() === "" ? "The core exited before it was ready." : log.trim());
    this.name = "CoreStartError";
  }
}

function parseReady(line: string): CoreReady | undefined {
  try {
    return coreReadySchema.parse(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function killTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    process.kill(-pid, "SIGKILL");
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, (error) =>
      error === null ? resolve() : reject(error),
    );
  });
}

export async function startCore(
  command: CoreCommand,
  { onCrash, stopTimeoutMs = STOP_TIMEOUT_MS }: CoreOptions,
): Promise<CoreProcess> {
  const child = spawn(command.executable, command.args, {
    env: command.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Its own process group on Linux, so a kill reaches everything it started.
    detached: process.platform !== "win32",
  });
  let log = "";
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    process.stderr.write(text);
    log = (log + text).slice(-LOG_TAIL_CHARACTERS);
  });
  const exited = once(child, "exit");
  let state: "starting" | "running" | "stopping" = "starting";
  exited.then(() => {
    if (state === "running") onCrash(log);
  });

  const lines = createInterface({ input: child.stdout });
  const first = await Promise.race([once(lines, "line"), exited.then(() => undefined)]);
  if (first === undefined) throw new CoreStartError(log);
  const ready = parseReady(String(first[0]));
  if (ready === undefined) {
    child.kill();
    throw new CoreStartError(`The core printed an unexpected first line: ${first[0]}`);
  }
  state = "running";

  return {
    ready,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      state = "stopping";
      child.stdin.end();
      const stopped = await Promise.race([
        exited.then(() => true),
        delay(stopTimeoutMs, false, { ref: false }),
      ]);
      if (stopped || child.pid === undefined) return;
      await killTree(child.pid);
      await exited;
    },
  };
}
