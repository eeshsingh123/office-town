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
  // Who the last task went to (`targets.ts`).
  target?: string;
  workspaceId?: string;
  byHarness: Record<string, HarnessChoices>;
}

const KEY = "office-town.new-task";
const RECENT_LIMIT = 5;

export const DEFAULT_CHOICES: HarnessChoices = {
  environment: { kind: "native" },
  autonomy: "full",
  recentModels: [],
};

// Bypass turns every guard off, so it is never brought back without its warning. Trusted is
// gone (D-57) and reads as Full, as the core's migration does.
function withoutBypass(remembered: Remembered): Remembered {
  const byHarness = Object.fromEntries(
    Object.entries(remembered.byHarness).map(([harness, choices]) => {
      const saved: string | undefined = choices.autonomy;
      if (saved === "bypass") return [harness, { ...choices, autonomy: "supervised" as const }];
      if (saved === "trusted") return [harness, { ...choices, autonomy: "full" as const }];
      return [harness, choices];
    }),
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

function save(remembered: Remembered): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(remembered));
  } catch (error) {
    console.warn("Could not save the last choices.", error);
  }
}

// Leaving an AI app keeps what was picked on it, for when the user comes back.
export function keepChoices(harness: string, choices: HarnessChoices): void {
  const remembered = loadRemembered();
  save({ ...remembered, byHarness: { ...remembered.byHarness, [harness]: choices } });
}

interface Started {
  harness: string;
  choices: HarnessChoices;
  target: string;
  workspaceId?: string | undefined;
  profileId?: string | undefined;
}

export function remember({ harness, choices, target, workspaceId, profileId }: Started): void {
  const remembered = loadRemembered();
  const recentModels =
    choices.model === undefined
      ? choices.recentModels
      : [choices.model, ...choices.recentModels.filter((id) => id !== choices.model)];
  const next: Remembered = {
    ...remembered,
    harness,
    target,
    byHarness: {
      ...remembered.byHarness,
      [harness]: { ...choices, recentModels: recentModels.slice(0, RECENT_LIMIT) },
    },
  };
  if (workspaceId === undefined) delete next.workspaceId;
  else next.workspaceId = workspaceId;
  if (profileId === undefined) delete next.profileId;
  else next.profileId = profileId;
  save(next);
}
