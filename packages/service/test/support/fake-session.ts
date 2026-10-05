import { randomUUID } from "node:crypto";
import type { SessionCommand, SessionEvent, SessionEventBody } from "@office-town/contract";
import type {
  CoreReport,
  LaunchExtras,
  LineListener,
  Session,
  SessionListener,
} from "@office-town/harness";

// Stands in for a harness session: the test plays the harness's part through `emit` and `line`.
export class FakeSession implements Session {
  readonly id = randomUUID();
  readonly capabilities = {
    reasoning: false,
    plan: false,
    effort: false,
    modelList: false,
    resume: true,
    usageLimits: false,
  };
  readonly sent: SessionCommand[] = [];
  readonly extras: LaunchExtras;
  readonly #listeners = new Set<SessionListener>();
  readonly #lineListeners = new Set<LineListener>();
  #sequence = 0;

  constructor(extras: LaunchExtras = {}) {
    this.extras = extras;
  }

  async send(command: SessionCommand): Promise<void> {
    this.sent.push(command);
    if (command.type === "start") {
      this.emit({ type: "session.started", payload: { harnessSessionId: `harness-${this.id}` } });
    }
    if (command.type === "stop") {
      this.emit({
        type: "session.ended",
        payload: command.idle
          ? { reason: "exited", exitCode: 0, idle: true }
          : { reason: "stopped", exitCode: 0 },
      });
    }
  }

  report(body: CoreReport): void {
    this.emit(body);
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeLines(listener: LineListener): () => void {
    this.#lineListeners.add(listener);
    return () => this.#lineListeners.delete(listener);
  }

  emit(body: SessionEventBody): void {
    this.#sequence += 1;
    const timestamp = new Date().toISOString();
    const event = { id: randomUUID(), sessionId: this.id, sequence: this.#sequence, timestamp };
    for (const listener of this.#listeners) listener({ ...event, ...body } as SessionEvent);
  }

  line(text: string, partial = false): void {
    for (const listener of this.#lineListeners) listener({ direction: "in", text, partial });
  }
}
