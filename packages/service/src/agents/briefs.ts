import type { AgentRecord, ConnectorPermission, ConnectorRecord } from "@office-town/contract";
import type { Message } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { SCRATCH_ASK } from "../task-folders.ts";

function section(title: string, lines: (string | undefined)[]): string | undefined {
  const body = lines.map((line) => line?.trim() ?? "").filter((line) => line !== "");
  return body.length === 0 ? undefined : `${title}\n${body.join("\n")}`;
}

// What an agent reads before every task, in this order: who the user is and how they like
// answers, its department's rules, then its own notes (D-55). Empty parts are left out.
export function instructionsFor(store: Store, agent: AgentRecord): string | undefined {
  const you = store.readSettings().you;
  const name = you?.name.trim() || "the user";
  const department =
    agent.departmentId === undefined ? undefined : store.getDepartment(agent.departmentId);
  const parts = [
    section(`About the person you work for (${name}):`, [you?.about]),
    section(`How ${name} likes answers:`, [
      ...(you?.answerStyle ?? []).map((pick) => `- ${pick}`),
      you?.answerNotes,
    ]),
    section(`Your team's rules (${department?.name ?? ""}):`, [department?.rules]),
    section("Your own notes:", [agent.settings.instructions]),
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

// Its tool alone is not enough: Claude defers it and never looks (D-73).
const CHECKLIST_ASK =
  "If your work changes files, call write_checklist before your final message: what to check, each with the result it expects, how to set up and run it, and what changed. The user can have a fresh agent run it.";

// Claude defers this tool too (M8).
export const SHOW_ASK =
  "When you make something the user should look at, such as a page, mockup, image, document or a running site, show it to them with show_result.";

// Models write their list once and leave it, which freezes the step the user sees.
export const PLAN_ASK =
  "If you keep a todo list, update it as you go: mark each step done as you finish it and start the next, as the user follows your progress there.";

// The user's words as they are, after what the agent reads first, if anything.
export function soloMessage(
  prompt: string,
  instructions: string | undefined,
  scratch = false,
): Message {
  const asks = [...(scratch ? [SCRATCH_ASK] : []), PLAN_ASK, SHOW_ASK, CHECKLIST_ASK];
  const task = `Your task:\n${prompt}\n\n${asks.join(" ")}`;
  if (instructions === undefined) {
    return { text: task, origin: { kind: "brief", summary: "The task, then its checklist" } };
  }
  return {
    text: `${instructions}\n\n${task}`,
    origin: { kind: "brief", summary: "Your profile and its notes, then the task" },
  };
}

export const PERMISSION_WORDS: Record<ConnectorPermission, string> = {
  read_only: "read only",
  ask: "it may change things once the user approves each change",
  dont_ask: "it may read and change things",
};

// Listed at the start of a conversation. A hub app given later is reached through the hub tools
// (D-67); the Claude apps stay as they are until the next conversation (D-68).
export function appsBrief(hub: ConnectorRecord[], claude: ConnectorRecord[]): string | undefined {
  if (hub.length === 0 && claude.length === 0) return undefined;
  const lines = [...hub, ...claude].map(
    ({ setup, permission }) => `- ${setup.name}: ${PERMISSION_WORDS[permission]}.`,
  );
  const fixed =
    claude.length === 0
      ? ""
      : " Your Claude apps are fixed for this conversation; one connected later is yours from your next task.";
  return `Apps you can use, each through its own tools:\n${lines.join("\n")}\nFor an app given to you later, find its tools with list_app_tools and call them with use_app_tool.${fixed} If the work needs an app you do not have, ask for it with request_app.`;
}
