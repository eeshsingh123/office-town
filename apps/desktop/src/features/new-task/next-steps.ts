import type { Autonomy } from "@office-town/contract";

export type Who = "one" | "team" | "chief";

interface Situation {
  who: Who;
  autonomy: Autonomy;
  // Set when a saved department takes the goal; otherwise a lead proposes a new team.
  departmentName: string | undefined;
  chiefName: string | undefined;
  chiefBusy: boolean;
  folder: string | undefined;
}

const ASKS: Record<Autonomy, string> = {
  supervised: "It checks with you before every change. You answer in Needs you.",
  trusted: "It asks you before running commands or using the web. You answer in Needs you.",
  full: "It goes ahead without asking. Every action is still recorded.",
  bypass: "It runs with no safety checks at all.",
};

// The side panel's words for what starting will do, and the start button's label.
export function nextSteps(situation: Situation): {
  title: string;
  steps: string[];
  action: string;
} {
  const { who, departmentName, chiefName } = situation;
  if (who === "chief") {
    const name = chiefName ?? "Your chief";
    return {
      title: `${name} plans it first`,
      action: chiefName === undefined ? "Give to the chief" : `Give to ${chiefName}`,
      steps: [
        ...(situation.chiefBusy ? [`It waits until ${name} finishes the goals ahead of it.`] : []),
        `${name} drafts a plan: which department does what, and in what order.`,
        "Nothing runs until you approve or change the plan in Needs you.",
        "Departments work in order and pass their results along. You review the end result.",
      ],
    };
  }
  if (who === "team" && departmentName !== undefined) {
    return {
      title: `${departmentName} takes it on`,
      action: `Give to ${departmentName}`,
      steps: [
        "The lead reads the goal and splits it between the team.",
        "Each person asks you when a step needs your OK, as the department is set up to.",
        "The lead puts the pieces together and hands you the result to review.",
      ],
    };
  }
  if (who === "team") {
    return {
      title: "A new team forms",
      action: "Start the team",
      steps: [
        "A lead reads the goal and suggests who to bring in, with an AI for each.",
        "You change or approve the team in Needs you before anyone starts.",
        "The team works on it and the lead hands you the result to review.",
      ],
    };
  }
  return {
    title: "Your assistant gets to work",
    action: "Start task",
    steps: [
      "It reads your task and works through it step by step. You can follow along.",
      ASKS[situation.autonomy],
      situation.folder === undefined
        ? "When it is done, you review the result."
        : `When it is done, you review the result in ${situation.folder}.`,
    ],
  };
}
