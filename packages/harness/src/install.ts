import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Installer, InstallSupport } from "./adapter.ts";
import { adapters, findAdapter } from "./adapters/registry.ts";
import { findBinary } from "./environment/find-binary.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { runProcess } from "./process-runner.ts";

export interface InstallExit {
  code: number | null;
  // The end of what it wrote to stderr, for a failure.
  stderr: string;
}

export interface RunningInstall {
  exited: Promise<InstallExit>;
  stop(): Promise<void>;
}

async function isHere(binary: string): Promise<boolean> {
  return findBinary(binary, process.env).then(
    () => true,
    () => false,
  );
}

// The first installer whose program is here; else what the user would install for the first one.
export async function installerHere(
  install: InstallSupport | undefined,
): Promise<{ found?: Installer; missing?: string }> {
  const installers =
    (process.platform === "win32" ? install?.installers.windows : install?.installers.unix) ?? [];
  for (const installer of installers) {
    if (await isHere(installer.needs)) return { found: installer };
  }
  const first = installers[0];
  return first === undefined ? {} : { missing: first.named ?? first.needs };
}

function addToPath(folder: string): void {
  if (!existsSync(folder)) return;
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const entries = (process.env[key] ?? "").split(delimiter).filter(Boolean);
  if (!entries.includes(folder)) process.env[key] = [...entries, folder].join(delimiter);
}

// An installer adds its folder to PATH for new terminals only, which an app started from a menu
// may never read, so the core adds each one it finds to its own PATH.
export function addInstallFoldersToPath(): void {
  for (const { install } of adapters) {
    for (const folder of install?.folders ?? []) addToPath(join(homedir(), folder));
  }
}

// Runs the vendor's own installer on this computer, unchanged (D-6, D-75). Native only: setup
// checks the native install.
export async function startHarnessInstall(
  harness: string,
  onLine: (line: string) => void,
): Promise<RunningInstall | undefined> {
  const { install } = findAdapter(harness);
  const command = (await installerHere(install)).found?.command;
  if (command === undefined) return undefined;
  const exited = Promise.withResolvers<InstallExit>();
  const running = await runProcess(new NativeEnvironment(), command, {
    onLine,
    onExit: (exit, stderr) => {
      if (exit.code === 0) addInstallFoldersToPath();
      exited.resolve({ code: exit.code, stderr });
    },
  });
  running.closeInput();
  return { exited: exited.promise, stop: () => running.killTree() };
}
