import { createHash } from "node:crypto";
import { FEED_BODY_CHARS, FEED_TITLE_CHARS } from "@office-town/contract";
import { z } from "zod";
import { redact } from "../notify/redact.ts";
import { draftOf, type PostDraft } from "../store/feed-store.ts";
import type { Store } from "../store/store.ts";
import { defineTool, ToolError } from "../tools/tools.ts";
import { clip, taskKey } from "./projector.ts";
import { mayFeedSuggest } from "./suggestions.ts";

const HOUR = 60 * 60_000;
// D-138: 3 posts a task an hour, 30 a minute across the app; past either, the words go on the
// task's card instead.
const TASK_POSTS_AN_HOUR = 3;
const POSTS_A_MINUTE = 30;
const MONTH = 30 * 24 * HOUR;

// The same words again, as a retried call sends them, are one post.
const sameKey = (kind: string, scope: string, text: string) =>
  `${kind}:${scope}:${createHash("sha256").update(text.trim().toLowerCase()).digest("hex").slice(0, 16)}`;

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
      if (follow_up !== undefined) return suggest(store, base, follow_up);
      const now = Date.now();
      const foldKey = sameKey("heads-up", ownerId, base.title);
      if (store.feed.latestFold(foldKey, now - HOUR) !== undefined) {
        return "Already posted: the user has this one.";
      }
      const crowded =
        store.feed.countForTask("heads-up", ownerId, now - HOUR) >= TASK_POSTS_AN_HOUR ||
        store.feed.countSince("heads-up", now - 60_000) >= POSTS_A_MINUTE;
      if (crowded) return foldIntoCard(store, ownerId, base.title);
      store.feed.create({ ...base, kind: "heads-up", state: "ended" }, { foldKey });
      return "Posted to the user's Feed.";
    },
  });
}

function foldIntoCard(store: Store, taskId: string, line: string): string {
  const card = store.feed.byKey(taskKey(taskId));
  if (card === undefined) {
    return "Not posted: you have posted enough for now. Put it in your result instead.";
  }
  store.feed.update(card, { ...draftOf(card), note: line });
  return "You have posted enough for now, so this line shows on your task's card instead.";
}

function suggest(store: Store, base: Omit<PostDraft, "kind" | "state">, prompt: string): string {
  if (!mayFeedSuggest(store, "follow-up")) {
    return "Not posted: the user is not taking suggestions now. Name it in your result instead.";
  }
  // Never the same suggestion twice a month (D-139).
  const foldKey = sameKey("suggest:follow-up", "", prompt);
  if (store.feed.latestFold(foldKey, Date.now() - MONTH) !== undefined) {
    return "Already suggested: the user has this one.";
  }
  store.feed.create(
    {
      ...base,
      kind: "suggested",
      state: "open",
      suggestion: {
        rule: "follow-up",
        open: {
          kind: "task",
          prompt: redact(prompt),
          ...(base.departmentId === undefined ? {} : { departmentId: base.departmentId }),
        },
      },
    },
    { foldKey },
  );
  return "Suggested to the user in Feed. They decide whether to start it.";
}
