import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { Environment, LaunchRequest, ProcessExit } from "./environment/environment.ts";

const STDERR_TAIL_CHARS = 8000;
const DRAIN_TIMEOUT_MS = 500;

export interface ProcessHandlers {
  onLine(line: string): void;
  onExit(exit: ProcessExit, stderrTail: string): void;
}

export interface RunningProcess {
  writeLine(line: string): void;
  closeInput(): void;
  killTree(): Promise<void>;
}

export async function runProcess(
  environment: Environment,
  request: LaunchRequest,
  handlers: ProcessHandlers,
): Promise<RunningProcess> {
  const child = await environment.launch(request);

  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on("line", (line) => handlers.onLine(line));
  const drained = once(lines, "close");

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
  });

  // A write that races with the process dying fails here; the exit handler reports the death.
  child.stdin.on("error", () => {});

  child.exited.then(async (exit) => {
    // Output still buffered in the pipe is delivered before the exit is reported. The timeout
    // covers an orphaned grandchild that keeps the pipe open forever.
    await Promise.race([drained, delay(DRAIN_TIMEOUT_MS, undefined, { ref: false })]);
    lines.close();
    handlers.onExit(exit, stderrTail);
  });

  return {
    writeLine: (line) => {
      child.stdin.write(`${line}\n`);
    },
    closeInput: () => {
      child.stdin.end();
    },
    killTree: () => child.killTree(),
  };
}
