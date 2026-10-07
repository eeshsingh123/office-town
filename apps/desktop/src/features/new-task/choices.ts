import type { Autonomy, EnvironmentSpec } from "@office-town/contract";

// When the agent is not made from a profile.
export interface HarnessChoices {
  environment: EnvironmentSpec;
  model?: string;
  effort?: string;
  // Choices saved before levels replaced permission modes have none.
  autonomy?: Autonomy;
  // Newest first.
  recentModels: string[];
}

export interface Remembered {
  harness?: string;
  profileId?: string;
  team?: boolean;
  workspaceId?: string;
  byHarness: Record<string, HarnessChoices>;
}

const KEY = "office-town.new-task";
const RECENT_LIMIT = 5;

export const DEFAULT_CHOICES: HarnessChoices = {
  environment: { kind: "native" },
  autonomy: "supervised",
  recentModels: [],
};

// Bypass turns every guard off, so it is never brought back without its warning.
function withoutBypass(remembered: Remembered): Remembered {
  const byHarness = Object.fromEntries(
    Object.entries(remembered.byHarness).map(([harness, choices]) => [
      harness,
      choices.autonomy === "bypass" ? { ...choices, autonomy: "supervised" as const } : choices,
    ]),
  );
  return { ...remembered, byHarness };
}

// Storage can be cleared or blocked; the form then starts from the defaults.
export function loadRemembered(): Remembered {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === null ? { byHarness: {} } : withoutBypass(JSON.parse(saved) as Remembered);
  } catch (error) {
    console.warn("Could not read the last choices.", error);
    return { byHarness: {} };
  }
}

export function remember(
  harness: string,
  choices: HarnessChoices,
  workspaceId?: string,
  profileId?: string,
  team = false,
): void {
  const remembered = loadRemembered();
  const recentModels =
    choices.model === undefined
      ? choices.recentModels
      : [choices.model, ...choices.recentModels.filter((id) => id !== choices.model)];
  const next: Remembered = {
    ...remembered,
    harness,
    byHarness: {
      ...remembered.byHarness,
      [harness]: { ...choices, recentModels: recentModels.slice(0, RECENT_LIMIT) },
    },
  };
  if (workspaceId === undefined) delete next.workspaceId;
  else next.workspaceId = workspaceId;
  if (profileId === undefined) delete next.profileId;
  else next.profileId = profileId;
  next.team = team;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Could not save the last choices.", error);
  }
}
