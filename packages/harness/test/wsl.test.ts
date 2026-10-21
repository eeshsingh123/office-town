import { describe, expect, it } from "vitest";
import type { LaunchRequest } from "../src/environment/environment.ts";
import { parseDistroList, WslEnvironment } from "../src/environment/wsl.ts";
import { toWindowsPath, toWslPath } from "../src/environment/wsl-paths.ts";
import { ScriptedEnvironment } from "./support/replay.ts";

describe("WSL path translation", () => {
  it("maps paths into the distro and back, leaving another distro's share untouched", () => {
    const otherDistro = "\\\\wsl.localhost\\Debian\\home\\dev";
    const cases: [string, string][] = [
      ["C:\\Projects\\office town", "/mnt/c/Projects/office town"],
      ["d:/data/file.txt", "/mnt/d/data/file.txt"],
      ["C:\\", "/mnt/c"],
      ["\\\\wsl.localhost\\Ubuntu\\home\\dev\\work", "/home/dev/work"],
      ["\\\\wsl$\\ubuntu\\home\\dev", "/home/dev"],
      ["\\\\wsl.localhost\\Ubuntu", "/"],
      ["/home/dev/work", "/home/dev/work"],
      [otherDistro, otherDistro],
    ];
    for (const [windowsPath, wslPath] of cases) {
      expect(toWslPath(windowsPath, "Ubuntu")).toBe(wslPath);
    }
    const back: [string, string][] = [
      ["/mnt/c/Projects/office town", "C:\\Projects\\office town"],
      ["/mnt/c", "C:\\"],
      ["/home/dev/work", "\\\\wsl.localhost\\Ubuntu\\home\\dev\\work"],
      ["/mnt/c/../../work/x", "\\\\wsl.localhost\\Ubuntu\\work\\x"],
      ["relative/file.txt", "relative/file.txt"],
    ];
    for (const [wslPath, windowsPath] of back) {
      expect(toWindowsPath(wslPath, "Ubuntu")).toBe(windowsPath);
    }
  });

  it("reads the distro list that wsl.exe prints in UTF-16, without Docker's own distros", () => {
    const printed = Buffer.from(
      "\uFEFFUbuntu\r\ndocker-desktop\r\nDebian-12\r\ndocker-desktop-data\r\n\r\n",
      "utf16le",
    );
    expect(parseDistroList(printed)).toEqual(["Ubuntu", "Debian-12"]);
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

  it("kills by launch marker inside the distro as well as the relay on the host", async () => {
    const { environment, host, commands } = fakeDistro({ claude: "/usr/bin/claude" });
    const launched = await environment.launch({ binary: "claude", args: [] });

    await launched.killTree();

    const marker = (host.request as LaunchRequest).env?.OFFICE_TOWN_LAUNCH;
    expect(commands.at(-1)?.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(commands.at(-1)?.at(-1)).toBe(marker);
    await expect(launched.exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
  });
});
