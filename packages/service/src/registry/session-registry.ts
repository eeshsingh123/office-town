import { randomUUID } from "node:crypto";
import type {
  AgentCommand,
  Attachment,
  Autonomy,
  MessageOrigin,
  PermissionMode,
  SessionCommand,
  SessionEvent,
  SessionEventBody,
  SessionOptions,
  SessionRecord,
} from "@office-town/contract";
import {
  createSession as createHarnessSession,
  type HarnessLine,
  type LaunchExtras,
  type Session,
  type ToolServer,
} from "@office-town/harness";
import {
  atLimit,
  type ChosenAccount,
  chooseAccount,
  handover,
  sessionAccountId,
} from "../accounts/accounts.ts";
import { forPrompt, hasAccess, withAccess } from "../attachments/attachments.ts";
import {
  type NewSession,
  RecordNotFoundError,
  type Store,
  type StoredEvent,
} from "../store/store.ts";
import { requireSessionFolders } from "../task-folders.ts";

export type HarnessSessionFactory = (options: SessionOptions, extras: LaunchExtras) => Session;

// One token per session, so a tool call names its agent.
export interface ToolAccess {
  // `bind` names the session once it exists, before it starts.
  grant(): { servers: ToolServer[]; bind(sessionId: string): void };
  revoke(sessionId: string): void;
}

export type CoreRequest = Extract<
  SessionEventBody,
  {
    type: "permission.requested" | "question.requested" | "proposal.requested" | "plan.requested";
  }
>;
export type AnswerCommand = Extract<AgentCommand, { requestId: string }>;

// What a request of the core's own comes to once answered.
export interface CoreAnswer {
  resolution: Extract<
    SessionEventBody,
    {
      type: "permission.resolved" | "question.resolved" | "proposal.resolved" | "plan.resolved";
    }
  >;
  // Runs once the resolution is recorded.
  afterwards?: () => Promise<void>;
}

// Throws an AnswerError if the answer does not fit the request.
export type CoreRequestHandler = (command: AnswerCommand) => CoreAnswer;

export class AnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerError";
  }
}

export interface PublishedEvent {
  position?: number;
  event: SessionEvent;
}

export type RegistryListener = (published: PublishedEvent) => void;

// A message with an origin was sent by the core in the user's place.
export interface Message {
  text: string;
  origin?: MessageOrigin;
  // Given read-only to the session before the message reaches it (D-64).
  attachments?: Attachment[];
  // Library items, listed as reference at the start of a conversation.
  reference?: Attachment[];
}

const filesOf = ({ attachments = [], reference = [] }: Message) => [...attachments, ...reference];

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
  // One conversation must never run in two sessions at once.
  conversation: string | undefined;
  // Set until the first message is sent, so a later one never overtakes it.
  firstMessage: Promise<void> | undefined;
  stopping: boolean;
  ended: PromiseWithResolvers<void>;
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

// The model is asked about only for an image, so a plain message reaches the agent at once.
const hasImage = (attachments: readonly Attachment[] = []) =>
  attachments.some((attachment) => attachment.kind === "image");

// "Always allow" an edit opens every folder for the rest of the session, a read-only one too.
function withoutAllowAlways(event: SessionEvent): SessionEvent {
  if (event.type !== "permission.requested") return event;
  const options = event.payload.options.filter((option) => option.kind !== "allow_always");
  if (options.length === 0) return event;
  return { ...event, payload: { ...event.payload, options } };
}

export type Guard = (
  session: SessionRecord,
  request: PermissionRequest["payload"],
) => Autonomy | undefined;

export interface RegistryOptions {
  createSession?: HarnessSessionFactory;
  tools?: ToolAccess;
  guard?: Guard;
  // Read at each start, so a resume follows a level changed since.
  permissionModeOf?: (agentId: string) => PermissionMode;
  // Whether the session's model can see an image sent inline.
  seesImages?: (options: SessionOptions) => Promise<boolean>;
  // The Library items an agent gets in a task (D-64).
  referenceOf?: (taskId: string, agentId: string) => Attachment[];
}

export class SessionRegistry {
  readonly #store: Store;
  readonly #createSession: HarnessSessionFactory;
  readonly #tools: ToolAccess | undefined;
  readonly #guard: Guard | undefined;
  readonly #permissionModeOf: ((agentId: string) => PermissionMode) | undefined;
  readonly #seesImages: (options: SessionOptions) => Promise<boolean>;
  readonly #referenceOf: (taskId: string, agentId: string) => Attachment[];
  readonly #live = new Map<string, LiveSession>();
  readonly #listeners = new Set<RegistryListener>();
  // By session and request id.
  readonly #asked = new Map<string, CoreRequestHandler>();
  readonly #outbox: PublishedEvent[] = [];
  #publishing = false;

  constructor(
    store: Store,
    {
      createSession = createHarnessSession,
      tools,
      guard,
      permissionModeOf,
      seesImages = async () => false,
      referenceOf = () => [],
    }: RegistryOptions = {},
  ) {
    this.#store = store;
    this.#createSession = createSession;
    this.#tools = tools;
    this.#guard = guard;
    this.#permissionModeOf = permissionModeOf;
    this.#seesImages = seesImages;
    this.#referenceOf = referenceOf;
    store.markInterrupted();
  }

  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start({ taskId, agentId, options: given, message: sent }: Launch): Promise<SessionRecord> {
    const message = this.#withReference(taskId, agentId, sent);
    const options = withAccess(given, filesOf(message));
    const session = this.#launch(options);
    return this.#run(session, { id: session.id, taskId, agentId, options }, message);
  }

  // A new conversation starts with the Library items, except those the user attached anyway.
  #withReference(taskId: string, agentId: string, message: Message): Message {
    const attached = new Set(message.attachments?.map((attachment) => attachment.id));
    const reference = this.#referenceOf(taskId, agentId).filter(
      (attachment) => !attached.has(attachment.id),
    );
    return reference.length === 0 ? message : { ...message, reference };
  }

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
    const moved = this.#movedAccount(earlier);
    if (moved !== undefined) {
      // A conversation stays with its login, so another account starts a new one (D-61).
      const { resumeSessionId: _, accountId: __, accountFolder: ___, ...rest } = earlier.options;
      const fresh = this.#withReference(earlier.taskId, earlier.agentId, message);
      const options = withAccess({ ...rest, ...moved, permissionMode }, filesOf(fresh));
      const session = this.#launch(options);
      const record = { id: session.id, taskId: earlier.taskId, agentId: earlier.agentId, options };
      const text = handover(this.#store.lastMessage(sessionId), message.text);
      return this.#run(session, record, { ...fresh, text });
    }
    const options = withAccess(
      { ...earlier.options, permissionMode, resumeSessionId: conversation },
      message.attachments ?? [],
    );
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

  // Another account for the agent, once the one its conversation is on has run out.
  #movedAccount(earlier: SessionRecord): ChosenAccount | undefined {
    const from = sessionAccountId(earlier.options);
    const agent = this.#store.getAgent(earlier.agentId);
    if (agent === undefined || !atLimit(this.#store, from)) return undefined;
    const next = chooseAccount(this.#store, agent.settings);
    return next.accountId === from ? undefined : next;
  }

  async send(sessionId: string, command: AgentCommand): Promise<void> {
    const live = this.#running(sessionId);
    const key = "requestId" in command ? askedKey(sessionId, command.requestId) : undefined;
    const handler = key === undefined ? undefined : this.#asked.get(key);
    if (handler !== undefined && key !== undefined && "requestId" in command) {
      const answer = handler(command);
      this.#asked.delete(key);
      live.session.report(answer.resolution);
      await answer.afterwards?.();
      return;
    }
    if (command.type === "answerProposal" || command.type === "answerPlan") {
      throw new AnswerError(`No proposal "${command.requestId}" is waiting.`);
    }
    if (command.type === "answerPermission") {
      if (live.readOnly) this.#requireOffered(sessionId, command.requestId, command.optionId);
      await live.session.send({ ...command, answeredBy: "user" });
      return;
    }
    await live.session.send(command);
  }

  // Read-only sessions are never offered "allow always"; refuse any option not offered.
  #requireOffered(sessionId: string, requestId: string, optionId: string): void {
    const request = this.#store
      .listPendingRequests()
      .requests.find(
        ({ event }) =>
          event.sessionId === sessionId &&
          event.type === "permission.requested" &&
          event.payload.requestId === requestId,
      )?.event;
    const offered =
      request?.type === "permission.requested" &&
      request.payload.options.some((option) => option.optionId === optionId);
    if (!offered) throw new AnswerError(`Request "${requestId}" offers no option "${optionId}".`);
  }

  // An agent that has ended cannot take it; the caller may resume it.
  async tell(sessionId: string, message: Message): Promise<void> {
    const live = this.#running(sessionId);
    // Storing the prompt before returning means the caller's next write never finds the lead idle.
    if (live.firstMessage !== undefined) await live.firstMessage;
    if (live.stopping) {
      await live.ended.promise;
      throw new SessionNotRunningError(sessionId);
    }
    const stored = this.#store.getSession(sessionId);
    if (stored === undefined) throw new RecordNotFoundError("session", sessionId);
    const attachments = message.attachments ?? [];
    // The harness was started without these folders; the policy and a later resume read them here.
    const record = hasAccess(stored.options, attachments)
      ? stored
      : this.#store.updateSessionOptions(sessionId, withAccess(stored.options, attachments));
    if (attachments.length > 0) live.readOnly = true;
    const sees = hasImage(attachments) ? await this.#seesImages(record.options) : false;
    await this.#running(sessionId).session.send(this.#prompt(record, message, sees));
  }

  // The answer goes to `onAnswer` instead of the harness; it lasts as long as the session.
  ask(sessionId: string, request: CoreRequest, onAnswer: CoreRequestHandler): void {
    const live = this.#running(sessionId);
    this.#asked.set(askedKey(sessionId, request.payload.requestId), onAnswer);
    live.session.report(request);
  }

  // `idle` ends the agent as finished, to be resumed when next needed.
  async stop(sessionId: string, idle = false): Promise<void> {
    const live = this.#running(sessionId);
    live.stopping = true;
    await live.session.send({ type: "stop", ...(idle ? { idle } : {}) });
  }

  isRunning(sessionId: string): boolean {
    return this.#live.has(sessionId);
  }

  // Recorded like a crash, so the sessions can be resumed later.
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
      firstMessage: ready.promise,
      stopping: false,
      ended: Promise.withResolvers<void>(),
      readOnly: (record.options.readOnlyPaths ?? []).length > 0,
    };
    this.#live.set(session.id, live);
    try {
      await session.send({ type: "start" });
      // A start that failed has already ended the session.
      if (this.#live.has(session.id)) {
        const sees = hasImage(message.attachments) ? await this.#seesImages(record.options) : false;
        await session.send(this.#prompt(record, message, sees));
      }
    } finally {
      live.firstMessage = undefined;
      ready.resolve();
    }
    const stored = this.#store.getSession(session.id);
    if (stored === undefined) throw new RecordNotFoundError("session", session.id);
    return stored;
  }

  // Sent in the task, so the files go with it when it is deleted.
  #prompt(
    session: Pick<SessionRecord, "taskId" | "options">,
    message: Message,
    seesImages: boolean,
  ): SessionCommand {
    const { text, origin, attachments = [], reference = [] } = message;
    const files = filesOf(message);
    if (files.length === 0) {
      return { type: "prompt", text, ...(origin === undefined ? {} : { origin }) };
    }
    this.#store.linkAttachments(
      session.taskId,
      files.map((attachment) => attachment.id),
    );
    return {
      type: "prompt",
      text,
      ...(origin === undefined ? {} : { origin }),
      attachments: [
        ...forPrompt(attachments, seesImages),
        ...reference.map((attachment) => ({ ...attachment, reference: true as const })),
      ],
    };
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
    // The core's own asks, such as a Library change, always wait for the user.
    if (this.#asked.has(askedKey(request.sessionId, request.payload.requestId))) return;
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

  // One more try once stopped, so a brief storage failure does not leave the session stuck "running".
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

  // Work that cannot be recorded cannot be traced, so the agent is stopped.
  #stopUnrecorded(live: LiveSession, error: unknown): void {
    live.recorded = false;
    this.#forget(live.session.id);
    this.#publishError(live, NOT_RECORDED, errorMessage(error));
    live.session.send({ type: "stop" }).catch((stopError: unknown) => {
      this.#publishError(live, NOT_STOPPED, errorMessage(stopError));
    });
  }

  // Never stored, so reusing the last sequence clashes with nothing in the log.
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

  // Events made by a listener wait their turn, so every listener sees store order.
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
