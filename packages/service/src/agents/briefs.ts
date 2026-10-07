import type { AgentSettings } from "@office-town/contract";
import type { Message } from "../registry/session-registry.ts";

// The user's words as they are, after the profile's instructions if any.
export function soloMessage(prompt: string, settings: AgentSettings): Message {
  const instructions = settings.instructions?.trim() ?? "";
  if (instructions === "") return { text: prompt };
  return {
    text: `${instructions}\n\nYour task:\n${prompt}`,
    origin: { kind: "brief", summary: "Your profile's instructions, then the task" },
  };
}
