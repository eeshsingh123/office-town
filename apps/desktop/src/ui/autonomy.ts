import type { Autonomy } from "@office-town/contract";

// The levels as the user reads them (D-40, MODULES M4.6), worded as how much it may do without asking.
// `short` names the level on its own, as on a chip where the question is not asked.
export const AUTONOMY: Record<Autonomy, { label: string; short: string; description: string }> = {
  supervised: {
    label: "Ask me first",
    short: "Asks first",
    description:
      "Checks with you before every change, command and web search. Each one waits in Needs you.",
  },
  full: {
    label: "Don't ask",
    short: "Goes ahead",
    description:
      "Goes ahead with everything and records every action. Folders you marked read-only still ask before any change.",
  },
  bypass: {
    label: "No safety checks",
    short: "No safety checks",
    description:
      "Uses the AI app's own bypass mode. Nothing is checked, read-only folders included.",
  },
};
