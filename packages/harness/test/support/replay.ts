import { once } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough, Writable } from "node:stream";
import type { PermissionOption, SessionCommand, SessionEvent } from "@office-town/contract";
import type {
  Adapter,
  AttachedToolServer,
  LaunchExtras,
  LaunchOptions,
  ToolServer,
} from "../../src/adapter.ts";
import type {
  Environment,
  LaunchedProcess,
  LaunchRequest,
  ProcessExit,
} from "../../src/environment/environment.ts";
import { type HarnessLine, HarnessSession } from "../../src/session.ts";

type RecordedCommand =
  | { type: "prompt"; text: string }
  | { type: "interrupt" }
  | { type: "answerPermission"; choose: PermissionOption["kind"] }
  | { type: "answerQuestion"; choose: string };

export type RecordingEntry = { receive: unknown } | { send: RecordedCommand };

export function loadLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}

export function loadRecording(file: string): RecordingEntry[] {
  return loadLines(file)
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as RecordingEntry);
}

export class ScriptedEnvironment implements Environment {
  readonly written: string[] = [];
  request: LaunchRequest | undefined;
  readonly #stdout = new PassThrough();
  readonly #stderr = new PassThrough();
  readonly #exited = Promise.withResolvers<ProcessExit>();

  async launch(request: LaunchRequest): Promise<LaunchedProcess> {
    this.request = request;
    const stdin = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        this.written.push(...chunk.toString().split("\n").filter(Boolean));
        done();
      },
    });
    stdin.on("finish", () => this.exit({ code: 0, signal: null }));
    return {
      stdin,
      stdout: this.#stdout,
      stderr: this.#stderr,
      exited: this.#exited.promise,
      killTree: async () => this.exit({ code: null, signal: "SIGKILL" }),
    };
  }

  toEnvironmentPath(hostPath: string): string {
    return hostPath;
  }

  toHostPath(environmentPath: string): string {
    return environmentPath;
  }

  reach({ name, url, token }: ToolServer): AttachedToolServer {
    return { transport: "http", name, url, headers: { Authorization: `Bearer ${token}` } };
  }

  async emitLine(line: string): Promise<void> {
    // Listeners run in order, so the session has handled the line once this one fires.
    const delivered = once(this.#stdout, "data");
    this.#stdout.write(`${line}\n`);
    await delivered;
  }

  exit(exit: ProcessExit, stderr = ""): void {
    this.#stderr.end(stderr);
    this.#stdout.end();
    this.#exited.resolve(exit);
  }
}

export const replayOptions: LaunchOptions = {
  harness: "replayed",
  environment: { kind: "native" },
  permissionMode: "ask",
  workspacePath: "/workspace",
  toolServers: [],
};

function answerFor(choose: string, events: SessionEvent[]): SessionCommand {
  const request = events.findLast((event) => event.type === "question.requested");
  if (request === undefined) {
    throw new Error(`The recording answers "${choose}" but no question is pending.`);
  }
  return {
    type: "answerQuestion",
    requestId: request.payload.requestId,
    answers: request.payload.questions.map(({ questionId }) => ({
      questionId,
      selected: [choose],
    })),
  };
}

function commandFor(recorded: RecordedCommand, events: SessionEvent[]): SessionCommand {
  if (recorded.type === "answerQuestion") return answerFor(recorded.choose, events);
  if (recorded.type !== "answerPermission") return recorded;
  const request = events.findLast((event) => event.type === "permission.requested");
  const option = request?.payload.options.find((candidate) => candidate.kind === recorded.choose);
  if (request === undefined || option === undefined) {
    throw new Error(`The recording answers "${recorded.choose}" but no such option is pending.`);
  }
  return {
    type: "answerPermission",
    requestId: request.payload.requestId,
    optionId: option.optionId,
  };
}

export interface ReceivedLine {
  partial: boolean;
  events: SessionEvent[];
}

export interface Replay {
  events: SessionEvent[];
  written: string[];
  lines: HarnessLine[];
  received: ReceivedLine[];
}

export async function replay(
  adapter: Adapter,
  recording: RecordingEntry[],
  options: LaunchOptions = replayOptions,
  extras: LaunchExtras = {},
): Promise<Replay> {
  const environment = new ScriptedEnvironment();
  const session = new HarnessSession(options, adapter, environment, extras);
  const events: SessionEvent[] = [];
  const lines: HarnessLine[] = [];
  const received: ReceivedLine[] = [];
  session.subscribe((event) => events.push(event));
  session.subscribeLines((line) => lines.push(line));

  await session.send({ type: "start" });
  for (const entry of recording) {
    if ("receive" in entry) {
      const before = events.length;
      await environment.emitLine(JSON.stringify(entry.receive));
      received.push({ partial: lines.at(-1)?.partial ?? false, events: events.slice(before) });
    } else {
      await session.send(commandFor(entry.send, events));
    }
  }
  await session.send({ type: "stop" });
  return { events, written: environment.written, lines, received };
}
