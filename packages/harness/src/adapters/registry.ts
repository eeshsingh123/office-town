import type { Adapter } from "../adapter.ts";
import { claudeAdapter } from "./claude/adapter.ts";

export const adapters: readonly Adapter[] = [claudeAdapter];

export class UnknownHarnessError extends Error {
  constructor(harness: string) {
    const known = adapters.map((adapter) => adapter.harness).join(", ");
    super(`Unknown harness "${harness}". Available: ${known}.`);
    this.name = "UnknownHarnessError";
  }
}

export function findAdapter(harness: string): Adapter {
  const adapter = adapters.find((candidate) => candidate.harness === harness);
  if (adapter === undefined) throw new UnknownHarnessError(harness);
  return adapter;
}
