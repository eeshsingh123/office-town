import type { Autonomy } from "@office-town/contract";

// The levels as the user reads them (D-40, MODULES M4.6). `short` names the level on a chip.
export const AUTONOMY: Record<Autonomy, { label: string; short: string; description: string }> = {
  supervised: {
    label: "Ask me first",
    short: "Asks first",
    description: "Asks before it edits a file, runs a command or searches the web.",
  },
  full: {
    label: "Don't ask",
    short: "Doesn't ask",
    description:
      "Edits files, runs commands and searches the web without asking. Still asks before changing a read-only folder.",
  },
  bypass: {
    label: "No safety checks",
    short: "No safety checks",
    description: "Turns off every check, read-only folders included.",
  },
};
