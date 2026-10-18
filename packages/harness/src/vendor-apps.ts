import type { VendorApp } from "@office-town/contract";
import type { Adapter, HarnessCommand } from "./adapter.ts";
import type { Environment } from "./environment/environment.ts";
import { runProcess } from "./process-runner.ts";

const POLL_MS = 500;

export class VendorAppsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorAppsError";
  }
}

// Asks the CLI for a login's apps without starting a turn, polling until it has them: their names
// only, or with `settled` until none is still connecting, else what it had by the timeout. A
// login with no apps answers an empty list throughout, so only the timeout ends it.
export async function readVendorApps(
  adapter: Adapter,
  environment: Environment,
  env: Record<string, string>,
  { settled, timeoutMs, signal }: { settled: boolean; timeoutMs: number; signal?: AbortSignal },
): Promise<VendorApp[]> {
  const support = adapter.vendorApps;
  if (support === undefined) return [];
  const found = Promise.withResolvers<VendorApp[]>();
  let last: VendorApp[] = [];
  const running = await runProcess(
    environment,
    { ...support.command, env: { ...support.command.env, ...env } },
    {
      onLine: (line) => {
        const read = support.read(line);
        if (read === undefined) return;
        last = read.apps;
        if (read.apps.length > 0 && !(settled && read.pending)) found.resolve(read.apps);
      },
      onExit: (exit, stderrTail) =>
        found.reject(
          new VendorAppsError(`${adapter.name} stopped (${exit.code}): ${stderrTail.trim()}`),
        ),
    },
  );
  signal?.addEventListener("abort", () => found.reject(new VendorAppsError("Stopped.")), {
    once: true,
  });
  for (const line of support.start) running.writeLine(line);
  const poll = setInterval(() => running.writeLine(support.poll), POLL_MS);
  const timeout = setTimeout(() => {
    if (settled) found.resolve(last);
    else found.reject(new VendorAppsError(`${adapter.name} did not list its apps in time.`));
  }, timeoutMs);
  try {
    return await found.promise;
  } finally {
    clearInterval(poll);
    clearTimeout(timeout);
    await running.killTree();
  }
}

// The vendor's page for an app's sign-in, which the CLI prints and then exits.
export async function readSignInPage(
  environment: Environment,
  command: HarnessCommand,
  pageOf: (output: string[]) => string | undefined,
): Promise<string> {
  const output: string[] = [];
  const exited = Promise.withResolvers<string>();
  const running = await runProcess(environment, command, {
    onLine: (line) => output.push(line),
    onExit: (_, stderrTail) => exited.resolve(stderrTail),
  });
  running.closeInput();
  const stderrTail = await exited.promise;
  const page = pageOf(output);
  if (page === undefined) throw new VendorAppsError(`No sign-in page: ${stderrTail.trim()}`);
  return page;
}
