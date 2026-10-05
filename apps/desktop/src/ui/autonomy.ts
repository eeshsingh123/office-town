import type { Autonomy } from "@office-town/contract";

// The levels as the user reads them (D-40, MODULES M4.6).
export const AUTONOMY: Record<Autonomy, { label: string; description: string }> = {
  supervised: { label: "Supervised", description: "Every request comes to you." },
  trusted: {
    label: "Trusted",
    description:
      "Reading and editing inside the workspace go ahead. Commands, web access, pushing code and anything outside the workspace ask you first.",
  },
  full: {
    label: "Full",
    description:
      "Everything goes ahead, other folders, pushing and pull requests included. Each action is still recorded.",
  },
  bypass: {
    label: "Bypass",
    description: "The harness's own bypass mode. Nothing is guarded or asked.",
  },
};
