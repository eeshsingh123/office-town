import type { RoleSettings } from "@office-town/contract";
import { z } from "zod";
import type { HarnessChoices } from "../team/briefs.ts";

// What the model writes; the core turns it into a draft the app can trust.
export const writtenPersonSchema = z.object({
  role: z.string().trim().min(1),
  purpose: z.string().default(""),
  instructions: z.string().default(""),
  harness: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  model_from_user: z.boolean().optional(),
  agent_id: z.string().optional(),
});
export type WrittenPerson = z.infer<typeof writtenPersonSchema>;

export const writtenReplyShape = {
  questions: z
    .array(
      z.object({ question: z.string().trim().min(1), options: z.array(z.string()).default([]) }),
    )
    .default([]),
  suggestions: z.array(z.string()).default([]),
};

// Kept short, as the screen shows them all.
export function asked(written: {
  questions: { question: string; options: string[] }[];
  suggestions: string[];
}) {
  return {
    questions: written.questions.slice(0, 3).map(({ question, options }) => ({
      question,
      options: options
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4),
    })),
    suggestions: written.suggestions
      .map((each) => each.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

export const ASKING = `- questions: ask only when the answer would change the draft and you cannot reasonably choose yourself; at most 3, each with up to 4 short options. Never ask about what the user already said. When you ask, leave the draft out. Otherwise questions is [].
- suggestions: up to 3 things the user may have missed that would make this work better, each written as a short change the user could ask for, such as "Add a reviewer who checks each page before it ships". [] if nothing is missing.`;

export function numbered(notes: readonly string[]): string {
  return notes.map((note, index) => `${index + 1}. ${note}`).join("\n");
}

// A harness or model that is not offered falls back to the drafter's harness and its default model.
export function settingsOf(
  written: Pick<WrittenPerson, "harness" | "model" | "effort" | "model_from_user">,
  choices: HarnessChoices[],
  drafter: RoleSettings,
): { settings: RoleSettings; modelGuessed: boolean } {
  const choice =
    choices.find((known) => known.harness.harness === written.harness) ??
    choices.find((known) => known.harness.harness === drafter.harness);
  const model = choice?.models.find((known) => known.id === written.model);
  const effort = model?.efforts.includes(written.effort ?? "") ? written.effort : undefined;
  return {
    settings: {
      harness: choice?.harness.harness ?? drafter.harness,
      environment: drafter.environment,
      ...(model === undefined ? {} : { model: model.id }),
      ...(effort === undefined ? {} : { effort }),
    },
    modelGuessed: model === undefined || written.model_from_user !== true,
  };
}
