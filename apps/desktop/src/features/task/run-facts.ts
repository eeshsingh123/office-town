import type { SessionRecord } from "@office-town/contract";
import { useShallow } from "zustand/react/shallow";
import type { Agent } from "../../store/agents.ts";
import { useLevel } from "../../store/agents.ts";
import { useApp, useHarnessName } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { scratchAlias } from "../../store/workspaces.ts";
import type { TokenTotals, Trace } from "../../trace/trace.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { compactCount, elapsed, environmentName } from "../../ui/format.ts";
import { sumUsage } from "../departments/usage.ts";
import { useModelName } from "../profiles/model-line.ts";
import { effortName } from "../profiles/model-name.ts";

export interface RunFacts {
  harness: string;
  model: string;
  effort?: string;
  permissions: { label: string; description: string };
  machine: string;
  folder?: string;
  folderAlias?: string;
  startedAt: string;
  duration: string;
  tokens: TokenTotals;
}

// A session cut off when the app closed has no end, so its last activity stands in.
function endOf(latest: SessionRecord, traces: readonly Trace[]): string {
  if (latest.endedAt !== undefined) return latest.endedAt;
  if (isOpen(latest)) return new Date().toISOString();
  const times = traces.flatMap((trace) =>
    [...trace.items.values()].flatMap((item) =>
      item.kind === "action"
        ? [item.endedAt ?? item.startedAt]
        : item.kind === "message"
          ? [item.at]
          : [],
    ),
  );
  return times.reduce((last, time) => (time > last ? time : last), latest.createdAt);
}

// What an agent runs on, for the side panel and the task page's run card.
export function useRunFacts(agent: Agent): RunFacts {
  const { latest } = agent;
  const first = agent.sessions[0] ?? latest;
  const { options } = latest;
  const traces = useApp(
    useShallow((state) => agent.sessions.flatMap((session) => state.traces[session.id] ?? [])),
  );
  const harness = useHarnessName(options.harness);
  const level = useLevel(agent.record);
  const model = useModelName(
    options,
    traces.findLast((trace) => trace.model !== undefined)?.model ?? options.model,
  );
  // A department shares one Scratch folder, so it goes by the department's name.
  const department = useApp((state) =>
    agent.record.departmentId === undefined
      ? undefined
      : state.departments[agent.record.departmentId],
  );
  const owner = department?.name ?? agent.name;
  return {
    harness,
    model,
    ...(options.effort === undefined ? {} : { effort: effortName(options.effort) }),
    permissions: AUTONOMY[level],
    machine: environmentName(options.environment),
    ...(options.workspacePath === undefined
      ? {}
      : {
          folder: options.workspacePath,
          folderAlias: scratchAlias(options.workspacePath, owner, first.createdAt),
        }),
    startedAt: first.createdAt,
    duration: elapsed(first.createdAt, endOf(latest, traces)),
    tokens: sumUsage(traces),
  };
}

export function tokenLine({ inputTokens, outputTokens, cachedInputTokens }: TokenTotals): string {
  return `${compactCount(inputTokens - cachedInputTokens + outputTokens)} tokens`;
}
