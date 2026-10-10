import type { AgentRecord } from "@office-town/contract";
import type { Message } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";

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

// The user's words as they are, after what the agent reads first, if anything.
export function soloMessage(prompt: string, instructions: string | undefined): Message {
  if (instructions === undefined) return { text: prompt };
  return {
    text: `${instructions}\n\nYour task:\n${prompt}`,
    origin: { kind: "brief", summary: "Your profile and its notes, then the task" },
  };
}
