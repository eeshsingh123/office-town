import type { HarnessDescription, StartTaskRequest } from "@office-town/contract";
import { DEFAULT_CHOICES, type Remembered } from "../new-task/choices.ts";

// New task's last solo choices; nothing when they name no place to work.
export function soloRequest(
  prompt: string,
  remembered: Remembered,
  harnesses: readonly HarnessDescription[],
  outputFolder: string | undefined,
): StartTaskRequest | undefined {
  const where =
    remembered.workspaceId !== undefined
      ? { workspaceId: remembered.workspaceId }
      : outputFolder !== undefined
        ? { outputFolder }
        : undefined;
  const harness = remembered.harness ?? harnesses[0]?.harness;
  if (where === undefined || harness === undefined) return undefined;
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
  return { prompt, agent, autonomy: autonomy ?? "supervised", ...where };
}
