import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { LaunchRequest } from "../src/environment/environment.ts";
import { BinaryNotFoundError } from "../src/environment/find-binary.ts";
import { WslEnvironment } from "../src/environment/wsl.ts";
import { toWindowsPath, toWslPath } from "../src/environment/wsl-paths.ts";
import { runProcess } from "../src/process-runner.ts";
import { ScriptedEnvironment } from "./support/replay.ts";

describe("WSL path translation", () => {
  it.each([
    ["C:\\Projects\\office town", "/mnt/c/Projects/office town"],
    ["d:/data/file.txt", "/mnt/d/data/file.txt"],
    ["C:\\", "/mnt/c"],
    ["\\\\wsl.localhost\\Ubuntu\\home\\dev\\work", "/home/dev/work"],
    ["\\\\wsl$\\ubuntu\\home\\dev", "/home/dev"],
    ["\\\\wsl.localhost\\Ubuntu", "/"],
    ["/home/dev/work", "/home/dev/work"],
  ])("maps the Windows path %s into the distro", (windowsPath, wslPath) => {
    expect(toWslPath(windowsPath, "Ubuntu")).toBe(wslPath);
  });

  it.each([
    ["/mnt/c/Projects/office town", "C:\\Projects\\office town"],
    ["/mnt/c", "C:\\"],
    ["/home/dev/work", "\\\\wsl.localhost\\Ubuntu\\home\\dev\\work"],
    ["relative/file.txt", "relative/file.txt"],
  ])("maps the distro path %s back to Windows", (wslPath, windowsPath) => {
    expect(toWindowsPath(wslPath, "Ubuntu")).toBe(windowsPath);
  });

  it("leaves another distro's share untouched", () => {
    const path = "\\\\wsl.localhost\\Debian\\home\\dev";
    expect(toWslPath(path, "Ubuntu")).toBe(path);
  });
});

function fakeDistro(binaries: Record<string, string>) {
  const host = new ScriptedEnvironment();
  const commands: string[][] = [];
  const run = async (_distro: string, command: string[]): Promise<string> => {
    commands.push(command);
    const found = binaries[command.at(-1) ?? ""];
    if (command[0] === "bash" && found === undefined) throw Object.assign(new Error(), { code: 1 });
    // An interactive shell may print its own noise before the answer.
    return `welcome banner\n${found ?? ""}\n`;
  };
  return { environment: new WslEnvironment("Ubuntu", host, run), host, commands };
}

describe("WslEnvironment", () => {
  it("launches the binary it found in the distro through wsl.exe, in the given folder", async () => {
    const { environment, host } = fakeDistro({ claude: "/home/dev/.local/bin/claude" });

    await environment.launch({ binary: "claude", args: ["--print", "a b"], cwd: "/mnt/c/work" });

    const request = host.request as LaunchRequest;
    expect(request.binary).toBe("wsl.exe");
    expect(request.args.slice(0, 5)).toEqual(["-d", "Ubuntu", "--cd", "/mnt/c/work", "-e"]);
    expect(request.args.slice(-3)).toEqual(["/home/dev/.local/bin/claude", "--print", "a b"]);
  });

  it("forwards the request's variables into the distro", async () => {
    const { environment, host } = fakeDistro({ opencode: "/usr/bin/opencode" });

    await environment.launch({ binary: "opencode", args: [], env: { SOME_CONFIG: "{}" } });

    const env = (host.request as LaunchRequest).env ?? {};
    expect(env.SOME_CONFIG).toBe("{}");
    expect(env.WSLENV?.split(":")).toEqual(
      expect.arrayContaining(["SOME_CONFIG/u", "OFFICE_TOWN_LAUNCH/u"]),
    );
  });

  it("kills by launch marker inside the distro as well as the relay on the host", async () => {
    const { environment, host, commands } = fakeDistro({ claude: "/usr/bin/claude" });
    const launched = await environment.launch({ binary: "claude", args: [] });

    await launched.killTree();

    const marker = (host.request as LaunchRequest).env?.OFFICE_TOWN_LAUNCH;
    expect(commands.at(-1)?.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(commands.at(-1)?.at(-1)).toBe(marker);
    await expect(launched.exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
  });

  it("follows a shell alias to the file it names", async () => {
    const { environment, host } = fakeDistro({ claude: "alias claude='/home/dev/bin/claude'" });

    await environment.launch({ binary: "claude", args: [] });

    expect((host.request as LaunchRequest).args.at(-1)).toBe("/home/dev/bin/claude");
  });

  it("says which distro lacks the binary", async () => {
    const { environment } = fakeDistro({});

    const launch = environment.launch({ binary: "claude", args: [] });

    await expect(launch).rejects.toBeInstanceOf(BinaryNotFoundError);
    await expect(launch).rejects.toThrow('WSL distro "Ubuntu"');
  });
});

function installedDistro(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const listing = execFileSync("wsl.exe", ["-l", "-q"], { windowsHide: true });
    return listing.toString("utf16le").split(/\r?\n/).find(Boolean)?.trim();
  } catch {
    return undefined;
  }
}

const distro = installedDistro();

describe.runIf(distro !== undefined)("WslEnvironment against an installed distro", () => {
  const countMarked = `n=0; for p in /proc/[0-9]*; do grep -qz "^OFFICE_TOWN_LAUNCH=" "$p/environ" 2>/dev/null && n=$((n+1)); done; echo $n`;
  const marked = () =>
    Number(execFileSync("wsl.exe", ["-d", distro as string, "-e", "sh", "-c", countMarked]));

  it("runs a command in the mapped folder and kills even a detached child", async () => {
    const environment = new WslEnvironment(distro as string);
    const lines: string[] = [];
    const { promise: ready, resolve } = Promise.withResolvers<void>();
    const { promise: exited, resolve: onExit } = Promise.withResolvers<void>();
    const script = 'pwd; echo "$1"; setsid nohup sleep 300 >/dev/null 2>&1 & read line';
    const running = await runProcess(
      environment,
      {
        binary: "sh",
        args: ["-c", script, "sh", "two words"],
        cwd: environment.toEnvironmentPath("C:\\Windows"),
      },
      {
        onLine: (line) => {
          lines.push(line);
          if (lines.length === 2) resolve();
        },
        onExit: () => onExit(),
      },
    );

    await ready;
    expect(lines).toEqual(["/mnt/c/Windows", "two words"]);
    expect(marked()).toBeGreaterThan(0);

    await running.killTree();
    await exited;
    expect(marked()).toBe(0);
  }, 30_000);

  it("names a distro that is not installed", async () => {
    const launch = new WslEnvironment("no-such-distro-office-town").launch({
      binary: "sh",
      args: [],
    });

    await expect(launch).rejects.toThrow('"no-such-distro-office-town" is not installed');
  }, 30_000);
});
