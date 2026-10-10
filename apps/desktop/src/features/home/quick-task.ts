import type { HarnessDescription, StartTaskRequest } from "@office-town/contract";
import { DEFAULT_CHOICES, type Remembered } from "../new-task/choices.ts";

// New task's last solo choices; nothing without a workspace to work in.
export function soloRequest(
  prompt: string,
  remembered: Remembered,
  harnesses: readonly HarnessDescription[],
  workspaceId: string | undefined,
): StartTaskRequest | undefined {
  const harness = remembered.harness ?? harnesses[0]?.harness;
  if (workspaceId === undefined || harness === undefined) return undefined;
  const { environment, model, effort, autonomy } = remembered.byHarness[harness] ?? DEFAULT_CHOICES;
  const agent: StartTaskRequest["agent"] =
    remembered.profileId !== undefined
      ? { profileId: remembered.profileId }
      : {
          settings: {
            harness,
            environment,
            ...(model === undefined ? {} : { model }),
            ...(effort === undefined ? {} : { effort }),
          },
        };
  return { prompt, agent, autonomy: autonomy ?? "full", workspaceId };
}
