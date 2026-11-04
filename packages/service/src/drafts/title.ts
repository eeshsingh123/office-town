import type { EnvironmentSpec, HarnessModel, RoleSettings } from "@office-town/contract";
import { z } from "zod";
import type { TeamContext } from "../team/members.ts";
import { askForJson } from "./run.ts";

const NATIVE: EnvironmentSpec = { kind: "native" };
const PROMPT_SHOWN = 4000;

const titleSchema = z.object({
  title: z
    .string()
    .trim()
    .transform((title) => title.replace(/[.!]+$/, ""))
    .pipe(z.string().min(1).max(80)),
});

function settingsOf(harness: string, model: HarnessModel): RoleSettings {
  return {
    harness,
    environment: NATIVE,
    model: model.resolvedId ?? model.id,
    ...(model.efforts.includes("low") ? { effort: "low" } : {}),
  };
}

// A few words need no strong model: OpenCode's free one first (owner), else the task's app at its cheapest.
async function writerFor(
  { readCatalog }: TeamContext,
  harness: string,
): Promise<RoleSettings | undefined> {
  // A failed read means OpenCode is not installed here, which only moves the title to the task's app.
  const opencode = await readCatalog("opencode", NATIVE).catch(() => undefined);
  const free = opencode?.models.find((model) => model.access === "free");
  if (free !== undefined) return settingsOf("opencode", free);
  const { models } = await readCatalog(harness, NATIVE);
  // Claude's catalog prices nothing, so its cheapest model is named.
  const cheap =
    models.find((model) => model.access === "free") ?? models.find((model) => model.id === "haiku");
  // With no cheap model known, a paid plan is not spent on a title.
  return cheap === undefined ? undefined : settingsOf(harness, cheap);
}

function titlePrompt(prompt: string): string {
  return [
    "Name the task below in 3 to 6 words, like a headline, in the task's own language.",
    "Use its subject words: the product, place, file or thing it is about.",
    'No quotes, no full stop, and no empty words such as "Task", "Help with" or "Request".',
    'Do not do the task. Reply with this JSON object only: {"title": "..."}',
    "",
    "The task:",
    prompt.slice(0, PROMPT_SHOWN),
  ].join("\n");
}

export type NameTask = (taskId: string, harness: string) => void;

// Runs beside the task; until it ends, or if it fails, the prompt names the task.
export const titlesFor =
  (context: TeamContext): NameTask =>
  (taskId, harness) => {
    const task = context.store.getTask(taskId);
    if (task === undefined) return;
    void writerFor(context, harness)
      .then(async (writer) => {
        if (writer === undefined) return;
        const { title } = await askForJson(context, writer, titlePrompt(task.prompt), titleSchema);
        context.store.setTaskTitle(taskId, title);
      })
      .catch((error: unknown) => console.error(`Could not name task ${taskId}.`, error));
  };
