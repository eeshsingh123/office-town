import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ActionKind,
  AdapterCapabilities,
  AnsweredBy,
  PermissionOption,
  PlanStep,
  Question,
  QuestionAnswer,
  SentAttachment,
  SessionCommand,
  SessionEvent,
  SessionEventBody,
  SessionOptions,
} from "@office-town/contract";
import type {
  Adapter,
  AdapterEvent,
  InlineImage,
  LaunchExtras,
  LaunchOptions,
  Translation,
  Translator,
} from "./adapter.ts";
import { attachmentNote } from "./attachments.ts";
import type { Environment, ProcessExit } from "./environment/environment.ts";
import { type RunningProcess, runProcess } from "./process-runner.ts";
import { readVendorApps } from "./vendor-apps.ts";

const STOP_GRACE_MS = 3000;
const APPS_TIMEOUT_MS = 10_000;
const UNREADABLE_LINE_CHARS = 500;

type PromptCommand = Extract<SessionCommand, { type: "prompt" }>;

type SessionState = "created" | "starting" | "active" | "stopping" | "failing" | "ended";

export type SessionListener = (event: SessionEvent) => void;

// A line exactly as it crossed the harness's stdio, for an audit copy.
export interface HarnessLine {
  direction: "in" | "out";
  text: string;
  // The line only carried a fragment of text that a later event reports whole.
  partial: boolean;
}

export type LineListener = (line: HarnessLine) => void;

// What the core itself adds to a session's stream: requests its tools make, and their answers.
export type CoreReport = Extract<
  SessionEventBody,
  {
    type:
      | "permission.requested"
      | "permission.resolved"
      | "question.requested"
      | "question.resolved"
      | "proposal.requested"
      | "proposal.resolved"
      | "plan.requested"
      | "plan.resolved";
  }
>;

export interface Session {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  send(command: SessionCommand): Promise<void>;
  // Numbered like the harness's own events, so the stream stays in one order.
  report(body: CoreReport): void;
  subscribe(listener: SessionListener): () => void;
  subscribeLines(listener: LineListener): () => void;
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HarnessSession implements Session {
  readonly id = randomUUID();
  readonly capabilities: AdapterCapabilities;

  readonly #options: LaunchOptions;
  readonly #adapter: Adapter;
  readonly #environment: Environment;
  readonly #translator: Translator;
  readonly #listeners = new Set<SessionListener>();
  readonly #lineListeners = new Set<LineListener>();
  readonly #pendingPermissions = new Map<string, PermissionOption[]>();
  readonly #pendingQuestions = new Map<string, Question[]>();
  // So a permission request carries what its action touches, whichever harness asked.
  readonly #openActions = new Map<string, { kind: ActionKind; locations?: string[] }>();
  readonly #launched = Promise.withResolvers<void>();
  readonly #ended = Promise.withResolvers<void>();
  #reportingListenerFailure = false;
  #state: SessionState = "created";
  #sequence = 0;
  #process: RunningProcess | undefined;
  #turnId: string | undefined;
  #plan: PlanStep[] = [];
  // Set when the core stops an agent left idle, which is recorded as finished, not stopped.
  #idle = false;
  readonly #tokens: string[];

  constructor(
    options: SessionOptions,
    adapter: Adapter,
    environment: Environment,
    extras: LaunchExtras = {},
  ) {
    const workspacePath = environment.toEnvironmentPath(options.workspacePath ?? process.cwd());
    const additionalPaths = options.additionalPaths?.map((path) =>
      environment.toEnvironmentPath(path),
    );
    const accountFolder =
      options.accountFolder === undefined
        ? undefined
        : environment.toEnvironmentPath(options.accountFolder);
    const toolServers = (extras.toolServers ?? []).map((server) => environment.reach(server));
    this.#tokens = toolServers.map((server) => server.token);
    this.#options = {
      ...options,
      workspacePath,
      toolServers,
      ...(additionalPaths && { additionalPaths }),
      ...(accountFolder && { accountFolder }),
    };
    this.#adapter = adapter;
    this.#environment = environment;
    this.#translator = adapter.createTranslator(this.#options);
    this.capabilities = adapter.capabilities;
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeLines(listener: LineListener): () => void {
    this.#lineListeners.add(listener);
    return () => this.#lineListeners.delete(listener);
  }

  async send(command: SessionCommand): Promise<void> {
    switch (command.type) {
      case "start":
        return this.#start();
      case "prompt":
        return this.#prompt(command);
      case "answerPermission":
        this.#requireActive("answer a permission");
        this.#answerPermission(command.requestId, command.optionId, command.answeredBy);
        return;
      case "answerQuestion":
        this.#requireActive("answer a question");
        this.#answerQuestion(command.requestId, command.answers);
        return;
      case "interrupt":
        this.#requireActive("interrupt");
        this.#apply(this.#translator.interrupt());
        return;
      case "stop":
        return this.#stop(command.idle === true);
    }
  }

  // The agent is told the paths it sees where it runs; the stream keeps host paths, as for actions.
  // An image goes inline only if the harness can carry it.
  #prompt(command: PromptCommand): void {
    this.#requireActive("prompt");
    const images: InlineImage[] = [];
    const sent = (command.attachments ?? []).map((attachment): SentAttachment => {
      const inline = attachment.inline === true && this.capabilities.images;
      if (inline) {
        const mimeType = attachment.mimeType ?? "image/png";
        images.push({ mimeType, data: readFileSync(attachment.path).toString("base64") });
      }
      return {
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        path: attachment.path,
        ...(attachment.bytes === undefined ? {} : { bytes: attachment.bytes }),
        ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }),
        ...(inline ? { inline } : {}),
        ...(attachment.reference ? { reference: attachment.reference } : {}),
      };
    });
    this.#emit({
      type: "message",
      payload: {
        role: "user",
        text: command.text,
        ...(command.origin === undefined ? {} : { origin: command.origin }),
        ...(sent.length === 0 ? {} : { attachments: sent }),
      },
    });
    const seen = sent.map((one) => ({
      ...one,
      path: this.#environment.toEnvironmentPath(one.path),
    }));
    this.#apply(this.#translator.prompt(command.text + attachmentNote(seen), images));
  }

  report(body: CoreReport): void {
    if (this.#state === "ended") {
      throw new SessionStateError("Cannot add to a session that has ended.");
    }
    this.#emit(body);
  }

  // The login's other apps are found now, as the user may connect one at any time; a list that
  // cannot be read turns every app off, so none the session may not use can reach it (D-68).
  async #withAppsBlocked(): Promise<LaunchOptions> {
    const allowed = this.#options.vendorApps ?? [];
    if (allowed.length === 0 || this.#adapter.vendorApps === undefined) return this.#options;
    const { accountFolder } = this.#options;
    const env =
      accountFolder === undefined ? {} : (this.#adapter.accounts?.env(accountFolder) ?? {});
    try {
      const apps = await readVendorApps(this.#adapter, this.#environment, env, {
        settled: false,
        timeoutMs: APPS_TIMEOUT_MS,
      });
      const blockedApps = apps.map(({ name }) => name).filter((name) => !allowed.includes(name));
      return { ...this.#options, blockedApps };
    } catch (error) {
      const message = `Its apps are off for this run: ${errorMessage(error)}`;
      this.#emit({ type: "error", payload: { message, fatal: false } });
      return { ...this.#options, vendorApps: [] };
    }
  }

  async #start(): Promise<void> {
    if (this.#state !== "created") {
      throw new SessionStateError(`Cannot start a session that is ${this.#state}.`);
    }
    if (this.#options.resumeSessionId !== undefined && !this.capabilities.resume) {
      const message = `The "${this.#adapter.harness}" harness cannot resume a session.`;
      this.#emit({ type: "error", payload: { message, fatal: true } });
      this.#end("failed", null);
      return;
    }
    this.#state = "starting";
    this.#reportIgnoredEffort();
    const request = {
      ...this.#adapter.buildCommand(await this.#withAppsBlocked()),
      cwd: this.#options.workspacePath,
    };
    try {
      this.#process = await runProcess(this.#environment, request, {
        onLine: (line) => this.#receive(line),
        onExit: (exit, stderrTail) => this.#handleExit(exit, stderrTail),
      });
    } catch (error) {
      this.#emit({ type: "error", payload: { message: errorMessage(error), fatal: true } });
      this.#end("failed", null);
      return;
    } finally {
      this.#launched.resolve();
    }
    this.#state = "active";
    this.#apply({ events: [], outgoing: this.#translator.open() });
  }

  #reportIgnoredEffort(): void {
    if (this.#options.effort === undefined || this.capabilities.effort) return;
    const message = `The "${this.#adapter.harness}" harness has no effort setting, so "${this.#options.effort}" was ignored.`;
    this.#emit({ type: "error", payload: { message, fatal: false } });
  }

  #answerPermission(requestId: string, optionId: string, answeredBy?: AnsweredBy): void {
    const option = this.#pendingPermissions.get(requestId)?.find((o) => o.optionId === optionId);
    if (option === undefined) {
      throw new SessionStateError(
        `No pending permission "${requestId}" with option "${optionId}".`,
      );
    }
    this.#pendingPermissions.delete(requestId);
    this.#apply(this.#translator.answerPermission(requestId, option));
    const outcome = option.kind.startsWith("allow") ? "allowed" : "denied";
    this.#emit({
      type: "permission.resolved",
      payload: {
        requestId,
        outcome,
        optionId,
        ...(answeredBy === undefined ? {} : { answeredBy }),
      },
    });
  }

  #answerQuestion(requestId: string, answers: QuestionAnswer[]): void {
    const questions = this.#pendingQuestions.get(requestId);
    if (questions === undefined) {
      throw new SessionStateError(`No pending question "${requestId}".`);
    }
    const answered = questions.map((question) => {
      const answer = answers.find((candidate) => candidate.questionId === question.questionId);
      if (answer === undefined) {
        throw new SessionStateError(`Question "${question.text}" was not answered.`);
      }
      return { question, selected: answer.selected };
    });
    this.#pendingQuestions.delete(requestId);
    this.#apply(this.#translator.answerQuestion(requestId, answered));
    const given = answered.map(({ question, selected }) => ({
      questionId: question.questionId,
      selected,
    }));
    this.#emit({
      type: "question.resolved",
      payload: { requestId, outcome: "answered", answers: given },
    });
  }

  async #stop(idle: boolean): Promise<void> {
    this.#idle = idle;
    if (this.#state === "created") this.#end("stopped", null);
    // A launch cannot be abandoned halfway, so a stop during startup waits for it to settle.
    if (this.#state === "starting") await this.#launched.promise;
    if (this.#state === "active" && this.#process !== undefined) {
      this.#state = "stopping";
      this.#process.closeInput();
      const exitedInTime = await Promise.race([
        this.#ended.promise.then(() => true),
        delay(STOP_GRACE_MS, false, { ref: false }),
      ]);
      if (!exitedInTime) await this.#process.killTree();
    }
    await this.#ended.promise;
  }

  #requireActive(action: string): void {
    if (this.#state !== "active") {
      throw new SessionStateError(`Cannot ${action} while the session is ${this.#state}.`);
    }
  }

  #apply(translation: Translation): void {
    for (const event of translation.events) this.#publish(event);
    for (const line of translation.outgoing) {
      if (this.#process === undefined) continue;
      this.#notifyLine({ direction: "out", text: line, partial: false });
      this.#process.writeLine(line);
    }
  }

  // Tokens last one launch and are never stored (D-43), so lines are handed on without them.
  #notifyLine(line: HarnessLine): void {
    const text = this.#tokens.reduce(
      (hidden, token) => hidden.replaceAll(token, "[token]"),
      line.text,
    );
    this.#notify(this.#lineListeners, { ...line, text });
  }

  #receive(line: string): void {
    let translation: Translation;
    try {
      translation = this.#translator.receive(line);
    } catch (error) {
      this.#notifyLine({ direction: "in", text: line, partial: false });
      this.#emit({
        type: "error",
        payload: {
          message: `Could not read harness output: ${errorMessage(error)}`,
          detail: line.slice(0, UNREADABLE_LINE_CHARS),
          fatal: false,
        },
      });
      return;
    }
    const partial = translation.partial ?? false;
    this.#notifyLine({ direction: "in", text: line, partial });
    this.#apply(translation);
  }

  #publish(event: AdapterEvent): void {
    switch (event.type) {
      case "turn.started":
        this.#turnId = randomUUID();
        this.#emit({ type: "turn.started", payload: { turnId: this.#turnId } });
        break;
      case "turn.ended":
        this.#endTurn(event.payload);
        break;
      case "plan.updated":
        this.#plan = event.payload.steps;
        this.#emit(event);
        break;
      case "action.started": {
        const payload = this.#attributeToPlan(this.#onHost(event.payload));
        this.#openActions.set(payload.actionId, {
          kind: payload.kind,
          ...(payload.locations === undefined ? {} : { locations: payload.locations }),
        });
        this.#emit({ ...event, payload });
        break;
      }
      case "action.ended":
        this.#openActions.delete(event.payload.actionId);
        this.#emit(event);
        break;
      case "permission.requested": {
        this.#pendingPermissions.set(event.payload.requestId, event.payload.options);
        const { actionId } = event.payload;
        const action = actionId === undefined ? undefined : this.#openActions.get(actionId);
        this.#emit({ ...event, payload: { ...event.payload, ...action } });
        break;
      }
      case "permission.resolved":
        this.#pendingPermissions.delete(event.payload.requestId);
        this.#emit(event);
        break;
      case "question.requested":
        this.#pendingQuestions.set(event.payload.requestId, event.payload.questions);
        this.#emit(event);
        break;
      case "question.resolved":
        this.#pendingQuestions.delete(event.payload.requestId);
        this.#emit(event);
        break;
      case "error":
        this.#emit(event);
        if (event.payload.fatal) this.#abandon();
        break;
      default:
        this.#emit(event);
    }
  }

  // The harness reports paths as it sees them; the caller needs them as the host sees them.
  #onHost<P extends { locations?: string[] | undefined }>(payload: P): P {
    if (payload.locations === undefined) return payload;
    const locations = payload.locations.map((path) => this.#environment.toHostPath(path));
    return { ...payload, locations };
  }

  #attributeToPlan<P extends { parentActionId?: string | undefined }>(payload: P): P {
    if (payload.parentActionId !== undefined) return payload;
    const stepInProgress = this.#plan.find((step) => step.status === "in_progress");
    return stepInProgress === undefined ? payload : { ...payload, planStepId: stepInProgress.id };
  }

  #endTurn(payload: Extract<AdapterEvent, { type: "turn.ended" }>["payload"]): void {
    const turnId = this.#turnId ?? randomUUID();
    this.#turnId = undefined;
    this.#emit({ type: "turn.ended", payload: { ...payload, turnId } });
  }

  // A harness that reported a fatal error cannot continue, so its process is not left running.
  #abandon(): void {
    if (this.#state !== "active" || this.#process === undefined) return;
    this.#state = "failing";
    this.#process.killTree().catch((error: unknown) => {
      this.#emit({ type: "error", payload: { message: errorMessage(error), fatal: true } });
    });
  }

  #handleExit(exit: ProcessExit, stderrTail: string): void {
    const state = this.#state;
    const stopping = state === "stopping";
    for (const requestId of this.#pendingPermissions.keys()) {
      this.#emit({ type: "permission.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#pendingPermissions.clear();
    for (const requestId of this.#pendingQuestions.keys()) {
      this.#emit({ type: "question.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#pendingQuestions.clear();
    for (const actionId of this.#openActions.keys()) {
      const result = "The harness stopped before this action finished.";
      this.#emit({ type: "action.ended", payload: { actionId, outcome: "failed", result } });
    }
    this.#openActions.clear();
    if (this.#turnId !== undefined) this.#endTurn({ outcome: stopping ? "interrupted" : "failed" });
    if (stopping || state === "failing" || exit.code === 0) {
      this.#end(stopping ? "stopped" : state === "failing" ? "failed" : "exited", exit.code);
      return;
    }
    this.#emit({
      type: "error",
      payload: {
        message: `The harness exited unexpectedly (${exit.signal ?? `code ${exit.code}`}).`,
        ...(stderrTail === "" ? {} : { detail: stderrTail }),
        fatal: true,
      },
    });
    this.#end("failed", exit.code);
  }

  #end(reason: "stopped" | "exited" | "failed", exitCode: number | null): void {
    this.#state = "ended";
    const idle = this.#idle && reason === "stopped";
    this.#emit({
      type: "session.ended",
      payload: idle ? { reason: "exited", exitCode, idle } : { reason, exitCode },
    });
    this.#ended.resolve();
  }

  #emit(body: SessionEventBody): void {
    this.#sequence += 1;
    const event: SessionEvent = {
      id: randomUUID(),
      sessionId: this.id,
      sequence: this.#sequence,
      timestamp: new Date().toISOString(),
      ...body,
    };
    this.#notify(this.#listeners, event);
  }

  #notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    const failures: unknown[] = [];
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const failure of failures) this.#reportListenerFailure(failure);
  }

  // One failing subscriber must not stop the others; a failure on the report itself is not reported again.
  #reportListenerFailure(failure: unknown): void {
    if (this.#reportingListenerFailure || this.#state === "ended") return;
    this.#reportingListenerFailure = true;
    const message = `A subscriber failed to handle an event: ${errorMessage(failure)}`;
    this.#emit({ type: "error", payload: { message, fatal: false } });
    this.#reportingListenerFailure = false;
  }
}
