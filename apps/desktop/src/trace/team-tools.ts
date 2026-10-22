import { type ActionKind, appsToolServer, teamToolServer } from "@office-town/contract";

type Input = Record<string, unknown>;

const words = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

// Whichever harness called them.
const TEAM_TOOLS: Record<string, { kind: ActionKind; title: (input: Input) => string }> = {
  ask_user: { kind: "other", title: (input) => `Asked you: ${words(input.question)}` },
  propose_team: { kind: "other", title: () => "Proposed a team" },
  delegate: { kind: "delegate", title: (input) => `Delegated to ${words(input.agent)}` },
  team_status: { kind: "other", title: () => "Checked on the team" },
  // Kept for traces from before D-73.
  outsource: { kind: "delegate", title: () => "Sent the work for review" },
  write_checklist: {
    kind: "other",
    title: (input) => `Wrote a checklist of ${count(input.items)} checks`,
  },
  propose_checks: {
    kind: "other",
    title: (input) => `Proposed ${count(input.items)} checks for you to approve`,
  },
  report_check: { kind: "other", title: (input) => `Reported ${count(input.results)} results` },
  propose_plan: { kind: "other", title: () => "Proposed a plan" },
  show_result: { kind: "other", title: (input) => `Showed you ${words(input.title)}` },
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

// "create_page" reads as "Create page"; a short text it was given is quoted after it.
export function callTitle(tool: string, input: unknown): string {
  const words = tool.replaceAll(/[_-]+/g, " ").trim();
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  const fields = input !== null && typeof input === "object" ? Object.values(input) : [];
  const text = fields.find(
    (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 60,
  );
  return text === undefined ? title : `${title}: "${text}"`;
}

// A connector's call, named by its app and tool; one through the hub by the app it reached (D-67).
export function appAction(tool: { server: string; name: string }, input: unknown) {
  if (tool.server === teamToolServer) return undefined;
  if (tool.server !== appsToolServer) {
    return { app: tool.server, title: callTitle(tool.name, input) };
  }
  const fields = input !== null && typeof input === "object" ? (input as Input) : {};
  if (tool.name !== "use_app_tool") return { app: words(fields.app), title: "Looked up its apps" };
  return { app: words(fields.app), title: callTitle(words(fields.tool), fields.arguments) };
}
