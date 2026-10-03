import { randomUUID } from "node:crypto";
import type { SessionCommand, SessionEvent, SessionOptions } from "@office-town/contract";
import {
  createSession as createHarnessSession,
  type HarnessLine,
  type Session,
} from "@office-town/harness";
import {
  type NewSession,
  RecordNotFoundError,
  type SessionRecord,
  type Store,
  type StoredEvent,
} from "../store/store.ts";

export type HarnessSessionFactory = (options: SessionOptions) => Session;

// Text fragments are published live but never stored, so they carry no position.
export interface PublishedEvent {
  position?: number;
  event: SessionEvent;
}

export type RegistryListener = (published: PublishedEvent) => void;

// Starting and stopping belong to the registry, so only these reach a running session.
export type AgentCommand = Exclude<SessionCommand, { type: "start" | "stop" }>;

export class SessionNotRunningError extends Error {
  constructor(id: string) {
    super(`Session "${id}" is not running.`);
    this.name = "SessionNotRunningError";
  }
}

export class SessionNotResumableError extends Error {
  constructor(id: string, reason: string) {
    super(`Session "${id}" cannot be resumed: ${reason}`);
    this.name = "SessionNotResumableError";
  }
}

interface LiveSession {
  session: Session;
  stopListening: () => void;
  lastSequence: number;
  recorded: boolean;
}

const NOT_RECORDED =
  "This agent's work could not be saved, so the agent was stopped. " +
  "Nothing it does from here on is in its history.";
const NOT_STOPPED = "The agent could not be stopped either, so it may still be running.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionRegistry {
  readonly #store: Store;
  readonly #createSession: HarnessSessionFactory;
  readonly #live = new Map<string, LiveSession>();
  readonly #listeners = new Set<RegistryListener>();

  constructor(store: Store, createSession: HarnessSessionFactory = createHarnessSession) {
    this.#store = store;
    this.#createSession = createSession;
    // Whatever an earlier core left running is not running now.
    store.markInterrupted();
  }

  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(prompt: string, options: SessionOptions): Promise<SessionRecord> {
    const session = this.#createSession(options);
    const task = this.#store.createTask(prompt);
    return this.#run(session, { id: session.id, taskId: task.id, options }, prompt);
  }

  // Continues an ended session's conversation in a new session of the same task.
  async resume(sessionId: string, prompt: string): Promise<SessionRecord> {
    const earlier = this.#store.getSession(sessionId);
    if (earlier === undefined) throw new RecordNotFoundError("session", sessionId);
    if (this.#live.has(sessionId)) {
      throw new SessionNotResumableError(sessionId, "it is still running.");
    }
    if (earlier.harnessSessionId === undefined) {
      throw new SessionNotResumableError(sessionId, "its harness never started a conversation.");
    }
    const options = { ...earlier.options, resumeSessionId: earlier.harnessSessionId };
    const session = this.#createSession(options);
    const record = { id: session.id, taskId: earlier.taskId, options, resumedFrom: sessionId };
    return this.#run(session, record, prompt);
  }

  async send(sessionId: string, command: AgentCommand): Promise<void> {
    await this.#running(sessionId).session.send(command);
  }

  async stop(sessionId: string): Promise<void> {
    await this.#running(sessionId).session.send({ type: "stop" });
  }

  // A shutdown is recorded like a crash: the sessions end interrupted and can be resumed later.
  async close(): Promise<void> {
    const running = [...this.#live.values()];
    this.#live.clear();
    for (const live of running) live.stopListening();
    const stops = await Promise.allSettled(
      running.map(({ session }) => session.send({ type: "stop" })),
    );
    this.#store.markInterrupted();
    const failures = stops.flatMap((stop) => (stop.status === "rejected" ? [stop.reason] : []));
    if (failures.length > 0) {
      throw new AggregateError(failures, "Some agents could not be stopped and may still run.");
    }
  }

  async #run(session: Session, record: NewSession, prompt: string): Promise<SessionRecord> {
    this.#store.createSession(record);
    const stopEvents = session.subscribe((event) => this.#record(live, event));
    const stopLines = session.subscribeLines((line) => this.#recordLine(live, line));
    const live: LiveSession = {
      session,
      stopListening: () => {
        stopEvents();
        stopLines();
      },
      lastSequence: 0,
      recorded: true,
    };
    this.#live.set(session.id, live);
    await session.send({ type: "start" });
    // A start that failed has already ended the session.
    if (this.#live.has(session.id)) await session.send({ type: "prompt", text: prompt });
    const stored = this.#store.getSession(session.id);
    if (stored === undefined) throw new RecordNotFoundError("session", session.id);
    return stored;
  }

  #running(sessionId: string): LiveSession {
    const live = this.#live.get(sessionId);
    if (live !== undefined) return live;
    if (this.#store.getSession(sessionId) === undefined) {
      throw new RecordNotFoundError("session", sessionId);
    }
    throw new SessionNotRunningError(sessionId);
  }

  #record(live: LiveSession, event: SessionEvent): void {
    live.lastSequence = event.sequence;
    if (event.type === "session.ended") this.#live.delete(event.sessionId);
    if (!live.recorded) {
      this.#publish({ event });
      return;
    }
    let stored: StoredEvent | undefined;
    try {
      stored = this.#store.append(event);
    } catch (error) {
      this.#publish({ event });
      this.#stopUnrecorded(live, error);
      return;
    }
    this.#publish(stored ?? { event });
  }

  #recordLine(live: LiveSession, line: HarnessLine): void {
    if (!live.recorded || line.partial) return;
    try {
      this.#store.appendHarnessLine(live.session.id, line.direction, line.text);
    } catch (error) {
      this.#stopUnrecorded(live, error);
    }
  }

  // Work that cannot be recorded cannot be traced, so the agent is stopped, not left unseen.
  #stopUnrecorded(live: LiveSession, error: unknown): void {
    live.recorded = false;
    this.#live.delete(live.session.id);
    this.#publishError(live, NOT_RECORDED, errorMessage(error));
    live.session.send({ type: "stop" }).catch((stopError: unknown) => {
      this.#publishError(live, NOT_STOPPED, errorMessage(stopError));
    });
  }

  // Never stored, so taking the session's last sequence clashes with nothing in the log and
  // leaves the session's own numbering intact.
  #publishError(live: LiveSession, message: string, detail: string): void {
    this.#publish({
      event: {
        id: randomUUID(),
        sessionId: live.session.id,
        sequence: live.lastSequence,
        timestamp: new Date().toISOString(),
        type: "error",
        payload: { message, detail, fatal: true },
      },
    });
  }

  #publish(published: PublishedEvent): void {
    for (const listener of this.#listeners) listener(published);
  }
}
