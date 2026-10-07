import { randomUUID } from "node:crypto";
import type {
  AgentCommand,
  Autonomy,
  MessageOrigin,
  PermissionMode,
  SessionEvent,
  SessionEventBody,
  SessionOptions,
  SessionRecord,
} from "@office-town/contract";
import {
  type CoreReport,
  createSession as createHarnessSession,
  type HarnessLine,
  type LaunchExtras,
  type Session,
  type ToolServer,
} from "@office-town/harness";
import {
  type NewSession,
  RecordNotFoundError,
  type Store,
  type StoredEvent,
} from "../store/store.ts";
import { requireSessionFolders } from "../task-folders.ts";

export type HarnessSessionFactory = (options: SessionOptions, extras: LaunchExtras) => Session;

// Gives each session the core's tool servers, with a token that names that session alone.
export interface ToolAccess {
  // `bind` names the session once it exists, before it starts.
  grant(): { servers: ToolServer[]; bind(sessionId: string): void };
  revoke(sessionId: string): void;
}

export type CoreRequest = Extract<
  SessionEventBody,
  { type: "question.requested" | "proposal.requested" | "plan.requested" }
>;
export type AnswerCommand = Extract<AgentCommand, { requestId: string }>;

// What a request of the core's own comes to once answered.
export interface CoreAnswer {
  resolution: Extract<
    SessionEventBody,
    { type: "question.resolved" | "proposal.resolved" | "plan.resolved" }
  >;
  // Runs once the resolution is recorded, such as telling the agent.
  afterwards?: () => Promise<void>;
}

// Reads the user's answer; throws an AnswerError if it does not fit the request.
export type CoreRequestHandler = (command: AnswerCommand) => CoreAnswer;

export class AnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerError";
  }
}

// Text fragments are published live but never stored, so they carry no position.
export interface PublishedEvent {
  position?: number;
  event: SessionEvent;
}

export type RegistryListener = (published: PublishedEvent) => void;

// A message the agent gets; one with an origin was sent by the core in the user's place.
export interface Message {
  text: string;
  origin?: MessageOrigin;
}

export interface Launch {
  taskId: string;
  agentId: string;
  options: SessionOptions;
  message: Message;
}

type SessionEndedEvent = Extract<SessionEvent, { type: "session.ended" }>;

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
  // The harness's own session id: one conversation must never run in two sessions at once.
  conversation: string | undefined;
  // Settles once the agent has its first message, so a later one never arrives before it.
  ready: Promise<void>;
  stopping: boolean;
  ended: PromiseWithResolvers<void>;
  // It has folders it may read but never change.
  readOnly: boolean;
}

const NOT_RECORDED =
  "This agent's work could not be saved, so the agent was stopped. " +
  "Nothing it does from here on is in its history.";
const NOT_STOPPED = "The agent could not be stopped either, so it may still be running.";

const askedKey = (sessionId: string, requestId: string) => `${sessionId}/${requestId}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PermissionRequest = Extract<SessionEvent, { type: "permission.requested" }>;

// "Always allow" an edit opens every folder for the rest of the session, a read-only one too.
function withoutAllowAlways(event: SessionEvent): SessionEvent {
  if (event.type !== "permission.requested") return event;
  const options = event.payload.options.filter((option) => option.kind !== "allow_always");
  if (options.length === 0) return event;
  return { ...event, payload: { ...event.payload, options } };
}

// Says which autonomy level lets a request through without the user, if any.
export type Guard = (
  session: SessionRecord,
  request: PermissionRequest["payload"],
) => Autonomy | undefined;

export interface RegistryOptions {
  createSession?: HarnessSessionFactory;
  tools?: ToolAccess;
  guard?: Guard;
  // The mode an agent's harness runs in now, so a resume follows a level changed since.
  permissionModeOf?: (agentId: string) => PermissionMode;
}

export class SessionRegistry {
  readonly #store: Store;
  readonly #createSession: HarnessSessionFactory;
  readonly #tools: ToolAccess | undefined;
  readonly #guard: Guard | undefined;
  readonly #permissionModeOf: ((agentId: string) => PermissionMode) | undefined;
  readonly #live = new Map<string, LiveSession>();
  readonly #listeners = new Set<RegistryListener>();
  // The core's own requests waiting for the user, by session and request id.
  readonly #asked = new Map<string, CoreRequestHandler>();
  readonly #outbox: PublishedEvent[] = [];
  #publishing = false;

  constructor(
    store: Store,
    { createSession = createHarnessSession, tools, guard, permissionModeOf }: RegistryOptions = {},
  ) {
    this.#store = store;
    this.#createSession = createSession;
    this.#tools = tools;
    this.#guard = guard;
    this.#permissionModeOf = permissionModeOf;
    // Whatever an earlier core left running is not running now.
    store.markInterrupted();
  }

  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Starts an agent's new session in a task, with its first message.
  async start({ taskId, agentId, options, message }: Launch): Promise<SessionRecord> {
    const session = this.#launch(options);
    return this.#run(session, { id: session.id, taskId, agentId, options }, message);
  }

  // Continues an ended session's conversation in a new session of the same task.
  async resume(sessionId: string, message: Message): Promise<SessionRecord> {
    const earlier = this.#store.getSession(sessionId);
    if (earlier === undefined) throw new RecordNotFoundError("session", sessionId);
    if (earlier.harnessSessionId === undefined) {
      throw new SessionNotResumableError(sessionId, "its harness never started a conversation.");
    }
    const conversation = earlier.harnessSessionId;
    if ([...this.#live.values()].some((live) => live.conversation === conversation)) {
      throw new SessionNotResumableError(sessionId, "its conversation is already running.");
    }
    requireSessionFolders(earlier.options);
    const permissionMode =
      this.#permissionModeOf?.(earlier.agentId) ?? earlier.options.permissionMode;
    const options = { ...earlier.options, permissionMode, resumeSessionId: conversation };
    const session = this.#launch(options);
    const record = {
      id: session.id,
      taskId: earlier.taskId,
      agentId: earlier.agentId,
      options,
      resumedFrom: sessionId,
    };
    return this.#run(session, record, message);
  }

  async send(sessionId: string, command: AgentCommand): Promise<void> {
    const live = this.#running(sessionId);
    const key = "requestId" in command ? askedKey(sessionId, command.requestId) : undefined;
    const handler = key === undefined ? undefined : this.#asked.get(key);
    if (handler !== undefined && key !== undefined && "requestId" in command) {
      const answer = handler(command);
      this.#asked.delete(key);
      live.session.report(answer.resolution as CoreReport);
      await answer.afterwards?.();
      return;
    }
    if (command.type === "answerProposal" || command.type === "answerPlan") {
      throw new AnswerError(`No proposal "${command.requestId}" is waiting.`);
    }
    if (command.type === "answerPermission") {
      await live.session.send({ ...command, answeredBy: "user" });
      return;
    }
    await live.session.send(command);
  }

  // A message from the core to a running agent, such as the answer to its question. An agent
  // being stopped cannot take it: once it has ended this says so, and the caller may resume it.
  async tell(sessionId: string, message: Message): Promise<void> {
    const live = this.#running(sessionId);
    await live.ready;
    if (live.stopping) {
      await live.ended.promise;
      throw new SessionNotRunningError(sessionId);
    }
    await this.#running(sessionId).session.send({ type: "prompt", ...message });
  }

  // Puts a request of the core's own in Needs you, stored and shown like a harness's; the answer
  // goes to `onAnswer` instead of the harness. It lasts as long as the session.
  ask(sessionId: string, request: CoreRequest, onAnswer: CoreRequestHandler): void {
    const live = this.#running(sessionId);
    this.#asked.set(askedKey(sessionId, request.payload.requestId), onAnswer);
    // The harness adds whatever the core reports to the stream; its type predates plans.
    live.session.report(request as CoreReport);
  }

  // `idle` ends an agent left idle as finished, to be resumed when it is next needed.
  async stop(sessionId: string, idle = false): Promise<void> {
    const live = this.#running(sessionId);
    live.stopping = true;
    await live.session.send({ type: "stop", ...(idle ? { idle } : {}) });
  }

  isRunning(sessionId: string): boolean {
    return this.#live.has(sessionId);
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

  async #run(session: Session, record: NewSession, message: Message): Promise<SessionRecord> {
    this.#store.createSession(record);
    const ready = Promise.withResolvers<void>();
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
      conversation: record.options.resumeSessionId,
      ready: ready.promise,
      stopping: false,
      ended: Promise.withResolvers<void>(),
      readOnly: (record.options.readOnlyPaths ?? []).length > 0,
    };
    this.#live.set(session.id, live);
    try {
      await session.send({ type: "start" });
      // A start that failed has already ended the session.
      if (this.#live.has(session.id)) await session.send({ type: "prompt", ...message });
    } finally {
      ready.resolve();
    }
    const stored = this.#store.getSession(session.id);
    if (stored === undefined) throw new RecordNotFoundError("session", session.id);
    return stored;
  }

  #launch(options: SessionOptions): Session {
    const grant = this.#tools?.grant();
    const session = this.#createSession(
      options,
      grant === undefined ? {} : { toolServers: grant.servers },
    );
    grant?.bind(session.id);
    return session;
  }

  #running(sessionId: string): LiveSession {
    const live = this.#live.get(sessionId);
    if (live !== undefined) return live;
    if (this.#store.getSession(sessionId) === undefined) {
      throw new RecordNotFoundError("session", sessionId);
    }
    throw new SessionNotRunningError(sessionId);
  }

  #record(live: LiveSession, received: SessionEvent): void {
    const event = live.readOnly ? withoutAllowAlways(received) : received;
    live.lastSequence = event.sequence;
    if (event.type === "session.started") live.conversation ??= event.payload.harnessSessionId;
    if (event.type === "session.ended") this.#forget(event.sessionId);
    if (!live.recorded) {
      this.#publish(event.type === "session.ended" ? this.#recordFailedEnd(event) : { event });
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
    if (event.type === "permission.requested") this.#letThrough(live, event);
  }

  // The request stays in the trace, answered by the level that allowed it.
  #letThrough(live: LiveSession, request: PermissionRequest): void {
    const session = this.#store.getSession(request.sessionId);
    const level = session === undefined ? undefined : this.#guard?.(session, request.payload);
    const allow = request.payload.options.find((option) => option.kind === "allow_once");
    if (level === undefined || allow === undefined) return;
    live.session
      .send({
        type: "answerPermission",
        requestId: request.payload.requestId,
        optionId: allow.optionId,
        answeredBy: { autonomy: level },
      })
      .catch((error: unknown) => {
        this.#publishError(live, "Autonomy could not answer a request.", errorMessage(error));
      });
  }

  // One more try once the agent has stopped, so a brief storage failure does not leave the session
  // "running" with no way to stop it or delete its task. The fatal error already told the user
  // that saving fails, so a second failure only leaves the session for the next start to interrupt.
  #recordFailedEnd(event: SessionEndedEvent): PublishedEvent {
    const failed = { ...event, payload: { ...event.payload, reason: "failed" as const } };
    try {
      return this.#store.append(failed) ?? { event: failed };
    } catch {
      return { event: failed };
    }
  }

  #recordLine(live: LiveSession, line: HarnessLine): void {
    if (!live.recorded || line.partial) return;
    try {
      this.#store.appendHarnessLine(live.session.id, line.direction, line.text);
    } catch (error) {
      this.#stopUnrecorded(live, error);
    }
  }

  #forget(sessionId: string): void {
    this.#live.get(sessionId)?.ended.resolve();
    this.#live.delete(sessionId);
    this.#tools?.revoke(sessionId);
    for (const key of this.#asked.keys()) {
      if (key.startsWith(askedKey(sessionId, ""))) this.#asked.delete(key);
    }
  }

  // Work that cannot be recorded cannot be traced, so the agent is stopped, not left unseen.
  #stopUnrecorded(live: LiveSession, error: unknown): void {
    live.recorded = false;
    this.#forget(live.session.id);
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

  // A listener that acts on an event, such as answering a request, makes new events while the
  // first is still being handed out. Those wait their turn, so every listener sees the events in
  // the order they were stored, and a stream never sends a later position before an earlier one.
  #publish(published: PublishedEvent): void {
    this.#outbox.push(published);
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      for (let next = this.#outbox.shift(); next !== undefined; next = this.#outbox.shift()) {
        for (const listener of this.#listeners) listener(next);
      }
    } finally {
      this.#publishing = false;
    }
  }
}
