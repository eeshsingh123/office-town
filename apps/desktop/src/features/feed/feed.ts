import { FEED_SHOWN, type FeedPost, type FeedShow } from "@office-town/contract";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

export interface FeedFilter {
  show: FeedShow;
  departmentId: string | undefined;
  search: string;
}

export const NO_FILTER: FeedFilter = { show: "all", departmentId: undefined, search: "" };

// A suggestion the user turned down is gone, as the core leaves it off every page.
export const isShown = (post: FeedPost) => post.kind !== "suggested" || post.state === "open";

// The same test the core's page makes, for posts that arrive live.
export function matches(post: FeedPost, filter: FeedFilter): boolean {
  if (!isShown(post)) return false;
  if (filter.show !== "all" && !FEED_SHOWN[filter.show].includes(post.kind)) return false;
  if (filter.departmentId !== undefined && post.departmentId !== filter.departmentId) return false;
  const search = filter.search.trim().toLowerCase();
  if (search === "") return true;
  return `${post.title}\n${post.body ?? ""}`.toLowerCase().includes(search);
}

export const newestFirst = (a: FeedPost, b: FeedPost) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

// Posts from newest down to the oldest one read for this filter, so no gap shows below.
export function postsInView(
  feed: Record<string, FeedPost>,
  filter: FeedFilter,
  oldest: FeedPost | undefined,
): FeedPost[] {
  return Object.values(feed)
    .filter((post) => matches(post, filter))
    .filter((post) => oldest === undefined || newestFirst(post, oldest) <= 0)
    .sort(newestFirst);
}

// When the newest post the sidebar dot counts was made.
export const newestShown = (feed: Record<string, FeedPost>) =>
  Object.values(feed)
    .filter(isShown)
    .reduce<string | undefined>(
      (at, post) => (at === undefined || post.createdAt > at ? post.createdAt : at),
      undefined,
    );

const isNew = (post: FeedPost, seenAt: string | undefined) =>
  isShown(post) && (seenAt === undefined || post.createdAt > seenAt);

// Posts since the user last looked; the newest page is read at launch, so at most a page.
export function useNewPosts(): number {
  return useApp((state) =>
    state.view.name === "feed"
      ? 0
      : Object.values(state.feed).filter((post) => isNew(post, state.feedSeenAt)).length,
  );
}

// Only forward, as the core keeps it.
export function markSeen(at: string): void {
  const seen = useApp.getState().feedSeenAt;
  if (seen !== undefined && at <= seen) return;
  useApp.setState({ feedSeenAt: at });
  api.markFeedSeen(at).catch((error: unknown) => console.warn("Could not mark Feed seen.", error));
}
