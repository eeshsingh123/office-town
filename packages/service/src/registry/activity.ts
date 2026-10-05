import type { SessionRegistry } from "./session-registry.ts";

export interface Activity {
  turnOpen: boolean;
  // The agent's last message of its latest turn: a worker's result.
  lastMessage: string | undefined;
  lastActive: number;
}

// What each running session is doing now, read from its events: whether a turn is open, what the
// agent last said, and when anything last happened.
export class SessionActivity {
  readonly #sessions = new Map<string, Activity>();

  constructor(registry: SessionRegistry) {
    registry.subscribe(({ event }) => {
      if (event.type === "session.ended") {
        // Every listener reads the session as it last was before it is forgotten.
        queueMicrotask(() => this.#sessions.delete(event.sessionId));
        return;
      }
      const activity = this.#sessions.get(event.sessionId) ?? {
        turnOpen: false,
        lastMessage: undefined,
        lastActive: Date.now(),
      };
      activity.lastActive = Date.now();
      if (event.type === "turn.started") {
        activity.turnOpen = true;
        activity.lastMessage = undefined;
      } else if (event.type === "turn.ended") {
        activity.turnOpen = false;
      } else if (
        event.type === "message" &&
        event.payload.role === "assistant" &&
        event.payload.parentActionId === undefined
      ) {
        activity.lastMessage = event.payload.text;
      }
      this.#sessions.set(event.sessionId, activity);
    });
  }

  of(sessionId: string): Activity | undefined {
    return this.#sessions.get(sessionId);
  }

  entries(): IterableIterator<[string, Activity]> {
    return this.#sessions.entries();
  }
}
