import { once } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough, Writable } from "node:stream";
import type {
  PermissionOption,
  SessionCommand,
  SessionEvent,
  SessionOptions,
} from "@office-town/contract";
import type { Adapter } from "../../src/adapter.ts";
import type {
  Environment,
  LaunchedProcess,
  LaunchRequest,
  ProcessExit,
} from "../../src/environment/environment.ts";
import { HarnessSession } from "../../src/session.ts";

type RecordedCommand =
  | { type: "prompt"; text: string }
  | { type: "interrupt" }
  | { type: "answerPermission"; choose: PermissionOption["kind"] };

export type RecordingEntry = { receive: unknown } | { send: RecordedCommand };

export function loadRecording(file: string): RecordingEntry[] {
  return readFileSync(file, "utf8")
    .split("\n")
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

export const replayOptions: SessionOptions = {
  harness: "replayed",
  environment: { kind: "native" },
  permissionMode: "ask",
};

function commandFor(recorded: RecordedCommand, events: SessionEvent[]): SessionCommand {
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

export interface Replay {
  events: SessionEvent[];
  written: string[];
}

export async function replay(adapter: Adapter, recording: RecordingEntry[]): Promise<Replay> {
  const environment = new ScriptedEnvironment();
  const session = new HarnessSession(replayOptions, adapter, environment);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));

  await session.send({ type: "start" });
  for (const entry of recording) {
    if ("receive" in entry) await environment.emitLine(JSON.stringify(entry.receive));
    else await session.send(commandFor(entry.send, events));
  }
  await session.send({ type: "stop" });
  return { events, written: environment.written };
}
