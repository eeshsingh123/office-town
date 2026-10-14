import type { ChiefDraftReply, ChiefDraftRequest } from "@office-town/contract";
import { z } from "zod";
import { describeChoices } from "../team/briefs.ts";
import type { TeamContext } from "../team/members.ts";
import { harnessChoices } from "../team/team-tasks.ts";
import { askForJson } from "./run.ts";
import { ASKING, asked, numbered, settingsOf, writtenReplyShape } from "./written.ts";

const writtenChiefSchema = z.object({
  ...writtenReplyShape,
  chief: z
    .object({
      name: z.string().trim().min(1),
      rules: z.string().default(""),
      harness: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      model_from_user: z.boolean().optional(),
    })
    .optional(),
});

// Names are handles such as "@atlas"; the app adds the "@".
const handleOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "chief";

export async function draftChief(
  context: TeamContext,
  request: ChiefDraftRequest,
): Promise<ChiefDraftReply> {
  const choices = await harnessChoices(context, request.drafter.environment);
  const departments = context.store.listDepartments();
  const known =
    departments.length === 0
      ? "The user has no departments yet."
      : `The user's departments: ${departments.map((each) => (each.purpose ? `${each.name} (${each.purpose})` : each.name)).join("; ")}.`;
  const draft =
    request.current === undefined
      ? ""
      : `\n\nThe current draft; change only what the user asks:\n${JSON.stringify(request.current)}`;
  const prompt = `You help a user of Office Town set up the chief: one AI agent that takes a big goal, splits it into parts, hands each part to one of the user's departments (teams of AI agents), and reports back. The user approves every plan.

Write the chief the user describes. Reply with one JSON object and nothing else:
{"questions":[{"question":"...","options":["..."]}],"suggestions":["..."],"chief":{"name":"...","rules":"...","harness":"...","model":"...","effort":"...","model_from_user":false}}

- name: a short lowercase name of letters, digits and hyphens; "chief" if the user gave none.
- rules: the planning rules the chief follows, one per line, taken from what the user said: how to split goals, which models to prefer for new departments, when to ask first. "" if the user gave none.
- Pick harness, model and effort from the list below. Planning needs a strong model; when the user did not name one, pick the strongest offered and set model_from_user to false.
${ASKING}

${known}

Harnesses and models:
${describeChoices(choices)}${draft}

What the user said, in order:
${numbered(request.notes)}`;
  const written = await askForJson(context, request.drafter, prompt, writtenChiefSchema);
  const chief = written.chief;
  return {
    ...asked(written),
    ...(chief === undefined
      ? {}
      : {
          chief: {
            name: handleOf(chief.name),
            rules: chief.rules.trim(),
            ...settingsOf(chief, choices, request.drafter),
          },
        }),
  };
}
