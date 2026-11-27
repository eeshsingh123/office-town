import {
  type FeedPost,
  feedQuerySchema,
  feedSeenRequestSchema,
  suggestionsRequestSchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { draftOf } from "../store/feed-store.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";

const NO_CONTENT = { status: 204 } as const;
const QUIET_FOR_MS = 30 * 24 * 60 * 60_000;

// Turned down: it leaves the page but still counts toward the day's suggestions (D-139).
function turnDown(store: Store, post: FeedPost): void {
  store.feed.update(post, { ...draftOf(post), state: "answered" });
}

function suggestionOf(store: Store, postId: string) {
  const post = store.feed.get(postId);
  if (post === undefined) return undefined;
  if (post.suggestion === undefined) {
    throw new RequestError(400, "invalid_request", "Only a suggestion can be dismissed.");
  }
  return { post, suggestion: post.suggestion };
}

// Only the user deletes a finished task's card, and with it its progress updates (D-141).
function removeCard(store: Store, post: FeedPost): void {
  if (post.taskId === undefined || post.state !== "ended" || post.kind === "milestone") {
    throw new RequestError(400, "invalid_request", "Only a finished task's card can be deleted.");
  }
  store.feed.remove(post.id);
}

export function feedRoutes(store: Store): Route[] {
  return [
    {
      method: "GET",
      path: "/feed",
      reply: ({ query }) => {
        const request = feedQuerySchema.parse({
          before: query.get("before") ?? undefined,
          show: query.get("show") ?? undefined,
          departmentId: query.get("departmentId") ?? undefined,
          search: query.get("search") || undefined,
        });
        return { status: 200, json: store.feed.page(request) };
      },
    },
    {
      method: "GET",
      path: "/feed/posts/:id/updates",
      // A card's own progress updates, newest first, a page at a time (D-141).
      reply: ({ param, query }) => {
        const post = store.feed.get(param("id"));
        if (post === undefined) throw new RecordNotFoundError("feed post");
        const before = query.get("before") || undefined;
        return { status: 200, json: store.feed.updatesOf(post.id, before) };
      },
    },
    {
      method: "GET",
      path: "/feed/images/:id",
      reply: ({ param }) => {
        const image = store.feed.image(param("id"));
        if (image === undefined) throw new RecordNotFoundError("picture");
        return {
          status: 200,
          bytes: Buffer.from(image.bytes),
          type: image.type,
          headers: { "cache-control": "private, max-age=31536000, immutable" },
        };
      },
    },
    {
      method: "POST",
      path: "/feed/seen",
      // Only forward: a window behind another never marks newer posts unseen.
      reply: async ({ body }) => {
        const { at } = feedSeenRequestSchema.parse(await body());
        const seen = store.readSettings().feedSeenAt;
        if (seen === undefined || Date.parse(at) > Date.parse(seen)) {
          store.saveSettings({ feedSeenAt: at });
        }
        return NO_CONTENT;
      },
    },
    {
      method: "PUT",
      path: "/feed/suggestions",
      reply: async ({ body }) => {
        const { on } = suggestionsRequestSchema.parse(await body());
        store.saveSettings({ suggestions: on });
        return NO_CONTENT;
      },
    },
    {
      method: "DELETE",
      path: "/feed/:id",
      // A suggestion is turned down; a finished task's card is deleted.
      reply: ({ param }) => {
        const post = store.feed.get(param("id"));
        if (post === undefined) return NO_CONTENT;
        if (post.suggestion === undefined) removeCard(store, post);
        else turnDown(store, post);
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/feed/:id/fewer",
      // Its rule stays quiet for 30 days (D-139).
      reply: ({ param }) => {
        const found = suggestionOf(store, param("id"));
        if (found === undefined) return NO_CONTENT;
        const quiet = store.readSettings().suggestionsQuietUntil ?? {};
        store.saveSettings({
          suggestionsQuietUntil: {
            ...quiet,
            [found.suggestion.rule]: new Date(Date.now() + QUIET_FOR_MS).toISOString(),
          },
        });
        turnDown(store, found.post);
        return NO_CONTENT;
      },
    },
  ];
}
