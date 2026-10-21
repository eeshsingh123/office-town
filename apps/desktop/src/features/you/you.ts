import type { UserProfile } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { pointsOf } from "../../ui/points.ts";

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

export interface PreviewSection {
  title: string;
  points: string[];
}

// The parts the core puts first in every agent's instructions (agents/briefs.ts), as points.
export function youPreview(you: UserProfile): PreviewSection[] {
  const name = you.name.trim() || "the user";
  return [
    { title: `About the person you work for (${name})`, points: pointsOf(you.about) },
    {
      title: `How ${name} likes answers`,
      points: [...you.answerStyle, ...pointsOf(you.answerNotes)],
    },
  ].filter((section) => section.points.length > 0);
}
