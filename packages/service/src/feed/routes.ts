import {
  feedQuerySchema,
  feedSeenRequestSchema,
  suggestionsRequestSchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import type { Store } from "../store/store.ts";

const NO_CONTENT = { status: 204 } as const;
const QUIET_FOR_MS = 30 * 24 * 60 * 60_000;

function suggestionOf(store: Store, postId: string) {
  const post = store.feed.get(postId);
  if (post === undefined) return undefined;
  if (post.suggestion === undefined) {
    throw new RequestError(400, "invalid_request", "Only a suggestion can be dismissed.");
  }
  return { post, suggestion: post.suggestion };
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
      reply: ({ param }) => {
        if (suggestionOf(store, param("id")) !== undefined) store.feed.remove(param("id"));
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
        store.feed.remove(found.post.id);
        return NO_CONTENT;
      },
    },
  ];
}
