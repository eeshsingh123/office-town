import type { Environment, ProcessExit } from "./environment/environment.ts";
import { runProcess } from "./process-runner.ts";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Runs one command to its end where a harness would run, such as git for a worker in WSL.
export async function runIn(
  environment: Environment,
  command: { binary: string; args: string[]; cwd?: string },
): Promise<CommandResult> {
  const lines: string[] = [];
  const exited = Promise.withResolvers<{ exit: ProcessExit; stderr: string }>();
  const running = await runProcess(environment, command, {
    onLine: (line) => lines.push(line),
    onExit: (exit, stderr) => exited.resolve({ exit, stderr }),
  });
  running.closeInput();
  const { exit, stderr } = await exited.promise;
  return { code: exit.code, stdout: lines.join("\n"), stderr };
}
