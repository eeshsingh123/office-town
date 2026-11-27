import type { FeedPost } from "@office-town/contract";
import { create } from "zustand";
import { onChange } from "../../store/live.ts";

// D-140: 6 seconds over the agent's desk, one per agent, a newer post replacing the older.
const BUBBLE_MS = 6_000;
const BUBBLED: ReadonlySet<FeedPost["kind"]> = new Set(["heads-up", "result", "stopped"]);

export const useRecentPosts = create<Record<string, FeedPost>>(() => ({}));

const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Called once, when the page loads. A card's updates make no bubble, so the floor stays calm.
export function followRecentPosts(): void {
  onChange((change) => {
    if (change.type !== "feed.post") return;
    const { post } = change;
    if (post.by.kind !== "agent" || !BUBBLED.has(post.kind)) return;
    if (Date.now() - Date.parse(post.createdAt) > BUBBLE_MS) return;
    const { agentId } = post.by;
    clearTimeout(timers.get(agentId));
    useRecentPosts.setState({ [agentId]: post });
    timers.set(
      agentId,
      setTimeout(() => {
        timers.delete(agentId);
        if (useRecentPosts.getState()[agentId]?.id !== post.id) return;
        const { [agentId]: _, ...rest } = useRecentPosts.getState();
        useRecentPosts.setState(rest, true);
      }, BUBBLE_MS),
    );
  });
}

const LABEL: Partial<Record<FeedPost["kind"], string>> = {
  "heads-up": "Heads-up",
  result: "Done",
  stopped: "Stopped",
};

export const bubbleText = (post: FeedPost) => `${LABEL[post.kind] ?? "Posted"}: ${post.title}`;
