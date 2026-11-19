import type { UserProfile } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";

// Agents read the picked words as they are. Length is one or the other; style can be several.
export const ANSWER_LENGTHS = ["Short and to the point", "Detailed, with the reasoning"] as const;

export const ANSWER_STYLES = [
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
