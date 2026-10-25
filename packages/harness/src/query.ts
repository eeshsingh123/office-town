import { setTimeout as delay } from "node:timers/promises";
import type { HarnessQuery } from "./adapter.ts";
import type { Environment, ProcessExit } from "./environment/environment.ts";
import { runProcess } from "./process-runner.ts";

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

type Outcome<T> = { answer: T } | { exit: ProcessExit; stderrTail: string };

// Runs the CLI where its agents run, with `env` added, and returns what `read` found.
export async function runQuery<T>(
  environment: Environment,
  query: HarnessQuery<T>,
  { env = {}, timeoutMs }: { env?: Record<string, string>; timeoutMs: number },
): Promise<T> {
  const output: string[] = [];
  const settled = Promise.withResolvers<Outcome<T>>();
  const running = await runProcess(
    environment,
    { ...query.command, env: { ...query.command.env, ...env } },
    {
      onLine: (line) => {
        output.push(line);
        if (!query.server) return;
        try {
          const answer = query.read(output);
          if (answer !== undefined) settled.resolve({ answer });
        } catch (error) {
          settled.reject(error);
        }
      },
      onExit: (exit, stderrTail) => settled.resolve({ exit, stderrTail }),
    },
  );
  for (const line of query.input ?? []) running.writeLine(line);
  if (!query.server) running.closeInput();

  try {
    const outcome = await Promise.race([
      settled.promise,
      delay(timeoutMs, undefined, { ref: false }),
    ]);
    if (outcome === undefined) throw new QueryError("It did not answer in time.");
    if ("answer" in outcome) return outcome.answer;
    const answer = query.read(output, outcome.stderrTail);
    if (answer !== undefined) return answer;
    const detail = outcome.stderrTail.trim();
    const code = outcome.exit.code ?? outcome.exit.signal;
    throw new QueryError(`It stopped (${code}) without answering${detail ? `: ${detail}` : "."}`);
  } finally {
    await running.killTree();
  }
}
