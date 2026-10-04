import type { EnvironmentSpec, PermissionMode } from "@office-town/contract";

// What the user picked last for a harness; saved agent profiles replace this in M4.
export interface HarnessChoices {
  environment: EnvironmentSpec;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  // Newest first.
  recentModels: string[];
}

export interface Remembered {
  harness?: string;
  workspaceId?: string;
  byHarness: Record<string, HarnessChoices>;
}

const KEY = "office-town.new-task";
const RECENT_LIMIT = 5;

export const DEFAULT_CHOICES: HarnessChoices = {
  environment: { kind: "native" },
  permissionMode: "ask",
  recentModels: [],
};

// Storage can be cleared or blocked; the form then starts from the defaults.
export function loadRemembered(): Remembered {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === null ? { byHarness: {} } : (JSON.parse(saved) as Remembered);
  } catch (error) {
    console.warn("Could not read the last choices.", error);
    return { byHarness: {} };
  }
}

export function remember(harness: string, choices: HarnessChoices, workspaceId?: string): void {
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
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Could not save the last choices.", error);
  }
}
