import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { HarnessQuery, ServedQuery } from "./adapter.ts";
import type { Environment, ProcessExit } from "./environment/environment.ts";
import { runProcess } from "./process-runner.ts";

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

type Outcome<T> = { answer: T } | { exit: ProcessExit; stderrTail: string };

// Starting a process blocks the core's thread on Windows, and every CLI boots on the same cores,
// so a burst of queries (launch reads six providers) froze the core for seconds (D-92).
const QUERIES_AT_ONCE = 2;
let queriesRunning = 0;
const queued: { start: () => void; refuse: (error: Error) => void }[] = [];
let stopped = false;

const stoppingError = () => new QueryError("The app is stopping.");

// A stopping core waits for every process it started, so the queries still waiting never start.
// The running ones end by themselves.
export function stopQueries(): void {
  stopped = true;
  for (const turn of queued.splice(0)) turn.refuse(stoppingError());
}

// Runs `run` once fewer than QUERIES_AT_ONCE one-off queries are running. Never for agent sessions.
export async function inQueryTurn<T>(run: () => Promise<T>): Promise<T> {
  if (stopped) throw stoppingError();
  if (queriesRunning < QUERIES_AT_ONCE) queriesRunning += 1;
  else await new Promise<void>((start, refuse) => queued.push({ start, refuse }));
  try {
    return await run();
  } finally {
    const next = queued.shift();
    if (next === undefined) queriesRunning -= 1;
    else next.start();
  }
}

// Runs the CLI where its agents run, with `env` added, and returns what `read` found.
export function runQuery<T>(
  environment: Environment,
  query: HarnessQuery<T>,
  options: { env?: Record<string, string>; timeoutMs: number },
): Promise<T> {
  return inQueryTurn(() => runQueryNow(environment, query, options));
}

const ASKS = 10;
const ASK_SPACING_MS = 250;

// Starts the private server, then asks it until it answers. Holds one query turn throughout.
export function runServedQuery<T>(
  environment: Environment,
  query: ServedQuery<T>,
  { timeoutMs }: { timeoutMs: number },
): Promise<T> {
  return inQueryTurn(async () => {
    const env = { [query.password]: randomUUID() };
    const address = Promise.withResolvers<string>();
    const server = await runProcess(
      environment,
      { ...query.server, env: { ...query.server.env, ...env } },
      {
        onLine: (line) => {
          const found = query.address(line);
          if (found !== undefined) address.resolve(found);
        },
        onExit: (exit, stderrTail) => {
          const detail = stderrTail.trim();
          const code = exit.code ?? exit.signal;
          address.reject(
            new QueryError(`It stopped (${code}) before it started${detail ? `: ${detail}` : "."}`),
          );
        },
      },
    );
    const deadline = Date.now() + timeoutMs;
    try {
      const url = await Promise.race([
        address.promise,
        delay(timeoutMs, undefined, { ref: false }),
      ]);
      if (url === undefined) throw new QueryError("It did not start in time.");
      const ask = { command: query.ask(url), read: (output: string[]) => query.read(output) };
      for (let asked = 1; ; asked += 1) {
        const left = deadline - Date.now();
        if (left <= 0) throw new QueryError("It did not answer in time.");
        try {
          return await runQueryNow(environment, ask, { env, timeoutMs: left });
        } catch (error) {
          if (!(error instanceof QueryError) || asked === ASKS) throw error;
        }
        await delay(ASK_SPACING_MS);
      }
    } finally {
      server.closeInput();
      await server.killTree();
    }
  });
}

async function runQueryNow<T>(
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
