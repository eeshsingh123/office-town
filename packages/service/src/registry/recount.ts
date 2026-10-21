import type { SessionRecord, TokenUsage } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import type { SessionRegistry } from "./session-registry.ts";

export type ReadUsage = (session: SessionRecord) => Promise<TokenUsage | undefined>;

// A moment for the harness to finish writing its records after its process exits.
const SETTLE_MS = 2000;
// At start, sessions that ended while the app was closed, or before it could recount them.
const LOOK_BACK_MS = 7 * 24 * 60 * 60 * 1000;

const missing = (real: number, recorded: number) => Math.max(0, real - recorded);

// Some harnesses report less than a turn used (OpenCode: only its last model step). Once a session
// ends, its conversation is read back from the harness's own records and the tokens its turns
// left out are added to it, so the task, the agent and the account all count them. Runs one at a
// time and never holds up the user's work. Settles once the recounts left from before are done.
export function followRecounts(
  registry: SessionRegistry,
  store: Store,
  harnesses: readonly string[],
  read: ReadUsage,
  settleMs = SETTLE_MS,
): Promise<void> {
  let queue = Promise.resolve();
  const waiting = new Set<string>();

  const recount = async (sessionId: string) => {
    const session = store.getSession(sessionId);
    const conversation = session?.harnessSessionId;
    if (session === undefined || conversation === undefined) return;
    const real = await read(session);
    if (real === undefined || registry.isRunning(sessionId)) return;
    const recorded = store.conversationUsage(session.options.harness, conversation);
    registry.appendToEnded(sessionId, {
      type: "usage.recounted",
      payload: {
        usage: {
          inputTokens: missing(real.inputTokens, recorded.inputTokens),
          outputTokens: missing(real.outputTokens, recorded.outputTokens),
          cachedInputTokens: missing(real.cachedInputTokens ?? 0, recorded.cachedInputTokens ?? 0),
        },
      },
    });
  };

  const enqueue = (sessionId: string, delay: number) => {
    if (waiting.has(sessionId)) return;
    waiting.add(sessionId);
    queue = queue
      .then(() => new Promise((done) => setTimeout(done, delay)))
      .then(() => recount(sessionId))
      .catch(() => {
        // Left as reported; the next session of the conversation tries again.
      })
      .finally(() => waiting.delete(sessionId));
  };

  registry.subscribe(({ event }) => {
    if (event.type !== "session.ended") return;
    const session = store.getSession(event.sessionId);
    if (session !== undefined && harnesses.includes(session.options.harness)) {
      enqueue(session.id, settleMs);
    }
  });

  // Only the latest session of each conversation: the recount covers the whole conversation.
  const since = new Date(Date.now() - LOOK_BACK_MS).toISOString();
  const latest = new Map<string, string>();
  for (const harness of harnesses) {
    for (const session of store.sessionsToRecount(harness, since)) {
      latest.set(`${harness}:${session.harnessSessionId}`, session.id);
    }
  }
  for (const sessionId of latest.values()) enqueue(sessionId, 0);
  return queue;
}
