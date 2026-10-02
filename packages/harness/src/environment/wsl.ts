import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Environment, LaunchedProcess, LaunchRequest } from "./environment.ts";
import { BinaryNotFoundError } from "./find-binary.ts";
import { NativeEnvironment } from "./native.ts";
import { toWindowsPath, toWslPath } from "./wsl-paths.ts";

const MARKER = "OFFICE_TOWN_LAUNCH";
const FIND_SCRIPT = 'command -v -- "$0"';
const EXEC_SCRIPT = 'exec "$0" "$@"';
// Every process in the launched tree inherits the marker variable, including ones that detached
// themselves, so matching on it reaches processes a signal to the relay would miss.
const KILL_SCRIPT = `for p in /proc/[0-9]*; do if grep -qz "^${MARKER}=$0$" "$p/environ" 2>/dev/null; then kill -9 "\${p#/proc/}"; fi; done`;
const NOT_FOUND_EXIT_CODE = 1;

export type DistroCommand = (distro: string, command: string[]) => Promise<string>;

async function runInDistro(distro: string, command: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)("wsl.exe", ["-d", distro, "-e", ...command], {
    windowsHide: true,
  });
  return stdout;
}

export class WslEnvironment implements Environment {
  readonly #distro: string;
  readonly #host: Environment;
  readonly #run: DistroCommand;

  constructor(distro: string, host: Environment = new NativeEnvironment(), run = runInDistro) {
    this.#distro = distro;
    this.#host = host;
    this.#run = run;
  }

  async launch(request: LaunchRequest): Promise<LaunchedProcess> {
    const binary = await this.#findBinary(request.binary);
    const marker = randomUUID();
    const env = { ...request.env, [MARKER]: marker };
    // WSLENV names the Windows variables that wsl.exe carries into the distro.
    const forwarded = Object.keys(env).map((name) => `${name}/u`);
    const relay = await this.#host.launch({
      binary: "wsl.exe",
      args: [
        ...["-d", this.#distro],
        ...(request.cwd === undefined ? [] : ["--cd", request.cwd]),
        // A login shell gives the harness the same PATH and variables the user has in a terminal.
        ...["-e", "bash", "-lc", EXEC_SCRIPT, binary],
        ...request.args,
      ],
      env: { ...env, WSLENV: [process.env.WSLENV, ...forwarded].filter(Boolean).join(":") },
    });
    const killTree = async (): Promise<void> => {
      try {
        await this.#run(this.#distro, ["sh", "-c", KILL_SCRIPT, marker]);
      } finally {
        await relay.killTree();
      }
    };
    return { ...relay, killTree };
  }

  toEnvironmentPath(hostPath: string): string {
    return toWslPath(hostPath, this.#distro);
  }

  toHostPath(environmentPath: string): string {
    return toWindowsPath(environmentPath, this.#distro);
  }

  async #findBinary(binary: string): Promise<string> {
    if (binary.startsWith("/")) return binary;
    // Interactive, because installers usually add their folder to PATH in .bashrc.
    const output = await this.#run(this.#distro, ["bash", "-lic", FIND_SCRIPT, binary]).catch(
      (error: unknown) => {
        if ((error as { code?: unknown }).code === NOT_FOUND_EXIT_CODE) return "";
        throw error;
      },
    );
    const found = output
      .split("\n")
      .map((line) => line.trim())
      .findLast((line) => line.startsWith("/"));
    if (found === undefined) {
      throw new BinaryNotFoundError(binary, `the PATH of the WSL distro "${this.#distro}"`);
    }
    return found;
  }
}
