import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  execFile,
} from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import spawn from "cross-spawn";
import type { AttachedToolServer, ToolServer } from "../adapter.ts";
import type { Environment, LaunchedProcess, LaunchRequest, ProcessExit } from "./environment.ts";
import { findBinary } from "./find-binary.ts";

const TERMINATE_GRACE_MS = 2000;
const isWindows = process.platform === "win32";

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function killWindowsTree(child: ChildProcess): Promise<void> {
  try {
    await promisify(execFile)("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  } catch (error) {
    // taskkill fails when the process exited on its own in the meantime, which is the goal.
    if (!hasExited(child)) throw error;
  }
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || hasExited(child)) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function killPosixTree(child: ChildProcess, exited: Promise<ProcessExit>): Promise<void> {
  signalGroup(child, "SIGTERM");
  await Promise.race([exited, delay(TERMINATE_GRACE_MS, undefined, { ref: false })]);
  signalGroup(child, "SIGKILL");
}

export class NativeEnvironment implements Environment {
  async launch(request: LaunchRequest): Promise<LaunchedProcess> {
    const env = { ...process.env, ...request.env };
    const binary = await findBinary(request.binary, env);
    // cross-spawn runs .cmd shims through cmd.exe with correct argument escaping.
    const child = spawn(binary, request.args, {
      cwd: request.cwd,
      env,
      windowsHide: true,
      // A POSIX child leads its own process group so the whole tree can be signalled at once.
      detached: !isWindows,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    const exited = new Promise<ProcessExit>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    await once(child, "spawn");

    const killTree = async (): Promise<void> => {
      if (hasExited(child)) return;
      await (isWindows ? killWindowsTree(child) : killPosixTree(child, exited));
      await exited;
    };
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited, killTree };
  }

  toEnvironmentPath(hostPath: string): string {
    return hostPath;
  }

  toHostPath(environmentPath: string): string {
    return environmentPath;
  }

  reach({ name, url, token }: ToolServer): AttachedToolServer {
    return { transport: "http", name, token, url, headers: { Authorization: `Bearer ${token}` } };
  }
}
