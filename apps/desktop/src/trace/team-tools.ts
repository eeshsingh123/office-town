import type { ActionKind } from "@office-town/contract";

type Input = Record<string, unknown>;

const words = (value: unknown) => (typeof value === "string" ? value : "");

// Whichever harness called them.
const TEAM_TOOLS: Record<string, { kind: ActionKind; title: (input: Input) => string }> = {
  ask_user: { kind: "other", title: (input) => `Asked you: ${words(input.question)}` },
  propose_team: { kind: "other", title: () => "Proposed a team" },
  delegate: { kind: "delegate", title: (input) => `Delegated to ${words(input.agent)}` },
  team_status: { kind: "other", title: () => "Checked on the team" },
  outsource: { kind: "delegate", title: () => "Asked for a second opinion" },
  propose_plan: { kind: "other", title: () => "Proposed a plan" },
  message_lead: {
    kind: "other",
    title: (input) => `Messaged the lead of ${words(input.department)}`,
  },
};

export function teamToolAction(name: string, input: unknown) {
  const tool = TEAM_TOOLS[name];
  if (tool === undefined) return undefined;
  const fields = input !== null && typeof input === "object" ? (input as Input) : {};
  return { kind: tool.kind, title: tool.title(fields) };
}
