import type { Autonomy } from "@office-town/contract";

// The levels as the user reads them (D-40, MODULES M4.6), worded as how much it may do without asking.
export const AUTONOMY: Record<Autonomy, { label: string; description: string }> = {
  supervised: {
    label: "Ask me first",
    description: "Checks with you before every change it makes.",
  },
  trusted: {
    label: "Ask for risky things",
    description:
      "Reads and edits files in the project freely. Asks before running commands, using the web, pushing code or touching other folders.",
  },
  full: {
    label: "Don't ask",
    description:
      "Goes ahead with everything, other folders and pushing code included. Every action is still recorded.",
  },
  bypass: {
    label: "No safety checks",
    description: "Uses the AI app's own bypass mode. Nothing is checked and nothing asks you.",
  },
};
