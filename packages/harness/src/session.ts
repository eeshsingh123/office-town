import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AdapterCapabilities,
  PermissionOption,
  PlanStep,
  SessionCommand,
  SessionEvent,
  SessionEventBody,
  SessionOptions,
} from "@office-town/contract";
import type { Adapter, AdapterEvent, Translator } from "./adapter.ts";
import type { Environment, ProcessExit } from "./environment/environment.ts";
import { type RunningProcess, runProcess } from "./process-runner.ts";

const STOP_GRACE_MS = 3000;
const UNREADABLE_LINE_CHARS = 500;

type SessionState = "created" | "starting" | "active" | "stopping" | "ended";

export type SessionListener = (event: SessionEvent) => void;

export interface Session {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  send(command: SessionCommand): Promise<void>;
  subscribe(listener: SessionListener): () => void;
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

  readonly #options: SessionOptions;
  readonly #adapter: Adapter;
  readonly #environment: Environment;
  readonly #translator: Translator;
  readonly #listeners = new Set<SessionListener>();
  readonly #pendingPermissions = new Map<string, PermissionOption[]>();
  readonly #ended = Promise.withResolvers<void>();
  #state: SessionState = "created";
  #sequence = 0;
  #process: RunningProcess | undefined;
  #turnId: string | undefined;
  #plan: PlanStep[] = [];

  constructor(options: SessionOptions, adapter: Adapter, environment: Environment) {
    this.#options = options;
    this.#adapter = adapter;
    this.#environment = environment;
    this.#translator = adapter.createTranslator(options);
    this.capabilities = adapter.capabilities;
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async send(command: SessionCommand): Promise<void> {
    switch (command.type) {
      case "start":
        return this.#start();
      case "prompt":
        return this.#prompt(command.text);
      case "answerPermission":
        return this.#answerPermission(command.requestId, command.optionId);
      case "interrupt":
        return this.#write(this.#translator.interrupt(), "interrupt");
      case "stop":
        return this.#stop();
    }
  }

  async #start(): Promise<void> {
    if (this.#state !== "created") {
      throw new SessionStateError(`Cannot start a session that is ${this.#state}.`);
    }
    this.#state = "starting";
    const { workspacePath } = this.#options;
    const request = {
      ...this.#adapter.buildCommand(this.#options),
      ...(workspacePath === undefined ? {} : { cwd: workspacePath }),
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
    }
    this.#state = "active";
    this.#write(this.#translator.open(), "start");
  }

  #prompt(text: string): void {
    this.#write(this.#translator.prompt(text), "prompt");
    this.#emit({ type: "message", payload: { role: "user", text } });
  }

  #answerPermission(requestId: string, optionId: string): void {
    const option = this.#pendingPermissions.get(requestId)?.find((o) => o.optionId === optionId);
    if (option === undefined) {
      throw new SessionStateError(
        `No pending permission "${requestId}" with option "${optionId}".`,
      );
    }
    this.#write(this.#translator.answerPermission(requestId, option), "answer a permission");
    this.#pendingPermissions.delete(requestId);
    const outcome = option.kind.startsWith("allow") ? "allowed" : "denied";
    this.#emit({ type: "permission.resolved", payload: { requestId, outcome, optionId } });
  }

  async #stop(): Promise<void> {
    if (this.#state === "created") this.#end("stopped", null);
    if (this.#state === "starting") {
      throw new SessionStateError("Cannot stop a session that is still starting.");
    }
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

  #write(lines: string[], action: string): void {
    if (this.#state !== "active" || this.#process === undefined) {
      throw new SessionStateError(`Cannot ${action} while the session is ${this.#state}.`);
    }
    for (const line of lines) this.#process.writeLine(line);
  }

  #receive(line: string): void {
    let translation: ReturnType<Translator["receive"]>;
    try {
      translation = this.#translator.receive(line);
    } catch (error) {
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
    for (const event of translation.events) this.#publish(event);
    for (const outgoing of translation.outgoing) this.#process?.writeLine(outgoing);
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
      case "action.started":
        this.#emit({ ...event, payload: this.#attributeToPlan(event.payload) });
        break;
      case "permission.requested":
        this.#pendingPermissions.set(event.payload.requestId, event.payload.options);
        this.#emit(event);
        break;
      case "permission.resolved":
        this.#pendingPermissions.delete(event.payload.requestId);
        this.#emit(event);
        break;
      default:
        this.#emit(event);
    }
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

  #handleExit(exit: ProcessExit, stderrTail: string): void {
    const stopping = this.#state === "stopping";
    for (const requestId of this.#pendingPermissions.keys()) {
      this.#emit({ type: "permission.resolved", payload: { requestId, outcome: "cancelled" } });
    }
    this.#pendingPermissions.clear();
    if (this.#turnId !== undefined) this.#endTurn({ outcome: stopping ? "interrupted" : "failed" });
    if (stopping || exit.code === 0) {
      this.#end(stopping ? "stopped" : "exited", exit.code);
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
    this.#emit({ type: "session.ended", payload: { reason, exitCode } });
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
    for (const listener of this.#listeners) listener(event);
  }
}
