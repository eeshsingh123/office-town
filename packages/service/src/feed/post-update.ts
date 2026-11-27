import { FEED_BODY_CHARS, FEED_TITLE_CHARS, type TaskRecord } from "@office-town/contract";
import { z } from "zod";
import { taskName } from "../notify/notifier.ts";
import { redact } from "../notify/redact.ts";
import type { PostDraft } from "../store/feed-store.ts";
import type { Store } from "../store/store.ts";
import { defineTool, ToolError } from "../tools/tools.ts";
import { clip, taskKey } from "./projector.ts";
import { mayFeedSuggest } from "./suggestions.ts";

const HOUR = 60 * 60_000;
// D-138: 3 posts a task an hour, 30 a minute across the app; past either, the words go on the
// task's card instead.
const TASK_POSTS_AN_HOUR = 3;
const POSTS_A_MINUTE = 30;

// An agent's own words in Feed: a heads-up, or a task it suggests the user start next.
export function postUpdate(store: Store) {
  return defineTool({
    name: "post_update",
    description:
      "Tell the user something they should know now, in Office Town's Feed: a blocker, a risk, " +
      "a surprise or a finding. Not for progress, which the user already sees. Give follow_up " +
      "instead to suggest a task the user could start next; they decide whether to start it.",
    input: z.object({
      title: z
        .string()
        .trim()
        .min(1)
        .max(FEED_TITLE_CHARS)
        .describe('One plain line, such as "Two tests already failed before my change".'),
      detail: z
        .string()
        .trim()
        .max(FEED_BODY_CHARS)
        .optional()
        .describe("One or two sentences more, if the line needs them."),
      follow_up: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .optional()
        .describe("A task to suggest, written as the task itself, for the user to start or not."),
    }),
    offeredTo: (caller) => store.getTask(caller.taskId)?.origin?.kind !== "check",
    call: ({ title, detail, follow_up }, caller) => {
      const task = store.getTask(caller.taskId);
      if (task === undefined) throw new ToolError("This task no longer exists.");
      // A part of a goal posts on the goal, where its card is.
      const ownerId = task.parentTaskId ?? task.id;
      const agent = store.getAgent(caller.agentId);
      const departmentId = task.departmentId ?? agent?.departmentId;
      const base = {
        by: { kind: "agent" as const, agentId: caller.agentId },
        title: clip(redact(title), FEED_TITLE_CHARS),
        ...(detail === undefined || detail === "" ? {} : { body: redact(detail) }),
        taskId: ownerId,
        sessionId: caller.sessionId,
        ...(departmentId === undefined ? {} : { departmentId }),
      };
      if (follow_up !== undefined) return suggest(store, base, follow_up, agent?.name, task);
      const now = Date.now();
      const crowded =
        store.feed.countForTask("heads-up", ownerId, now - HOUR) >= TASK_POSTS_AN_HOUR ||
        store.feed.countSince("heads-up", now - 60_000) >= POSTS_A_MINUTE;
      if (crowded) return foldIntoCard(store, ownerId, base.title);
      store.feed.create({ ...base, kind: "heads-up", state: "ended" });
      return "Posted to the user's Feed.";
    },
  });
}

function foldIntoCard(store: Store, taskId: string, line: string): string {
  const card = store.feed.byKey(taskKey(taskId));
  if (card === undefined) {
    return "Not posted: you have posted enough for now. Put it in your result instead.";
  }
  const { id: _, createdAt: __, updatedAt: ___, ...draft } = card;
  store.feed.update(card, { ...draft, note: line });
  return "You have posted enough for now, so this line shows on your task's card instead.";
}

function suggest(
  store: Store,
  base: Omit<PostDraft, "kind" | "state">,
  prompt: string,
  agentName: string | undefined,
  task: TaskRecord,
): string {
  if (!mayFeedSuggest(store, "follow-up")) {
    return "Not posted: the user is not taking suggestions now. Name it in your result instead.";
  }
  store.feed.create({
    ...base,
    kind: "suggested",
    state: "open",
    suggestion: {
      rule: "follow-up",
      why: `${agentName ?? "An agent"} suggested it while working on "${taskName(task)}".`,
      open: {
        kind: "task",
        prompt: redact(prompt),
        ...(base.departmentId === undefined ? {} : { departmentId: base.departmentId }),
      },
    },
  });
  return "Suggested to the user in Feed. They decide whether to start it.";
}
