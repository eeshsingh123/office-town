import type { UserProfile } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";

export const ANSWER_PICKS = [
  "Short and to the point",
  "Explain the why",
  "Plain words, no jargon",
  "Step by step",
  "Ask before big changes",
] as const;

// Until the user saves their profile: no text, and a pop-up only when an agent needs them.
export const DEFAULT_YOU: UserProfile = {
  name: "",
  colour: "#A2456E",
  about: "",
  answerStyle: [],
  answerNotes: "",
  notifyNeedsYou: true,
  notifyFinished: false,
};

export function useYou(): UserProfile {
  return useApp((state) => state.you) ?? DEFAULT_YOU;
}

// The same text the core puts first in every agent's instructions (agents/briefs.ts).
export function youPreview(you: UserProfile): string {
  const name = you.name.trim() || "the user";
  const style = [...you.answerStyle.map((pick) => `- ${pick}`), you.answerNotes.trim()].filter(
    (line) => line !== "",
  );
  return [
    you.about.trim() === "" ? "" : `About the person you work for (${name}):\n${you.about.trim()}`,
    style.length === 0 ? "" : `How ${name} likes answers:\n${style.join("\n")}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}
