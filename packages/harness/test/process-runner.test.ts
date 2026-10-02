import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { ProcessExit } from "../src/environment/environment.ts";
import { BinaryNotFoundError } from "../src/environment/find-binary.ts";
import { NativeEnvironment } from "../src/environment/native.ts";
import { type RunningProcess, runProcess } from "../src/process-runner.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

interface Observed {
  process: RunningProcess;
  lines: string[];
  exited: Promise<{ exit: ProcessExit; stderrTail: string }>;
  nextLine(): Promise<string>;
}

async function observe(binary: string, args: string[]): Promise<Observed> {
  const lines: string[] = [];
  let delivered = 0;
  let notify = () => {};
  const { promise: exited, resolve } = Promise.withResolvers<{
    exit: ProcessExit;
    stderrTail: string;
  }>();
  const process = await runProcess(
    new NativeEnvironment(),
    { binary, args },
    {
      onLine: (line) => {
        lines.push(line);
        notify();
      },
      onExit: (exit, stderrTail) => resolve({ exit, stderrTail }),
    },
  );
  const nextLine = async (): Promise<string> => {
    while (lines.length <= delivered) {
      await new Promise<void>((wake) => {
        notify = wake;
      });
    }
    return lines[delivered++] as string;
  };
  return { process, lines, exited, nextLine };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("runProcess in the native environment", () => {
  it("delivers stdout as lines and writes lines to stdin", async () => {
    const observed = await observe(process.execPath, [fixture("echo.mjs"), "one", "two words"]);
    cleanups.push(() => observed.process.killTree());

    expect(await observed.nextLine()).toBe('args:["one","two words"]');
    observed.process.writeLine("hello");
    expect(await observed.nextLine()).toBe("echo:hello");
  });

  it("reports the exit code and captured stderr after the last line", async () => {
    const observed = await observe(process.execPath, [fixture("echo.mjs")]);
    observed.process.writeLine("last");
    observed.process.writeLine("fail");

    const { exit, stderrTail } = await observed.exited;
    expect(exit.code).toBe(3);
    expect(stderrTail).toContain("something broke");
    expect(observed.lines.at(-1)).toBe("echo:last");
  });

  it("exits cleanly when input is closed", async () => {
    const observed = await observe(process.execPath, [fixture("echo.mjs")]);
    observed.process.closeInput();

    expect((await observed.exited).exit.code).toBe(0);
  });

  it("kills the whole process tree", async () => {
    const observed = await observe(process.execPath, [fixture("tree.mjs")]);
    const grandchildPid = Number(await observed.nextLine());
    expect(isAlive(grandchildPid)).toBe(true);

    await observed.process.killTree();
    await observed.exited;
    // The OS may take a moment to reap a signalled process.
    for (let attempt = 0; attempt < 20 && isAlive(grandchildPid); attempt++) await delay(50);
    expect(isAlive(grandchildPid)).toBe(false);
  });

  it("rejects when the binary is not on PATH", async () => {
    await expect(observe("no-such-binary-office-town", [])).rejects.toBeInstanceOf(
      BinaryNotFoundError,
    );
  });

  it.runIf(process.platform === "win32")(
    "launches a .cmd shim found on PATH with arguments intact",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "office town shim "));
      cleanups.push(() => rm(directory, { recursive: true, force: true }));
      await writeFile(
        path.join(directory, "shim.cmd"),
        `@"${process.execPath}" "${fixture("echo.mjs")}" %*\r\n`,
      );
      const lines: string[] = [];
      const { promise: firstLine, resolve } = Promise.withResolvers<string>();
      const running = await runProcess(
        new NativeEnvironment(),
        {
          binary: "shim",
          args: ["a b", 'say "hi"', "50%", "x&y"],
          env: { PATH: `${directory};${process.env.PATH}` },
        },
        {
          onLine: (line) => {
            lines.push(line);
            resolve(line);
          },
          onExit: () => {},
        },
      );
      cleanups.push(() => running.killTree());

      expect(await firstLine).toBe('args:["a b","say \\"hi\\"","50%","x&y"]');
    },
  );
});
