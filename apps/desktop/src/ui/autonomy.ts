import type { Autonomy } from "@office-town/contract";

// The levels as the user reads them (D-40, MODULES M4.6).
export const AUTONOMY: Record<Autonomy, { label: string; description: string }> = {
  supervised: {
    label: "Manual",
    description: "Asks before editing files, running commands or using the web.",
  },
  full: {
    label: "Auto",
    description:
      "Edits files, runs commands and uses the web without asking. Still asks before changing a read-only folder.",
  },
  bypass: {
    label: "No safety checks",
    description: "No checks at all, read-only folders included.",
  },
};
