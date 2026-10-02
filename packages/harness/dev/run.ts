import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  type PermissionOption,
  permissionModeSchema,
  type SessionEvent,
  type SessionOptions,
} from "@office-town/contract";
import { createSession, listHarnesses } from "../src/index.ts";
import { formatEvent } from "./format.ts";

const USAGE = `Usage: pnpm dev:run "<prompt>" [options]

  --harness <name>            ${listHarnesses().join(" | ")} (default: claude)
  --model <name>              model for the session
  --effort <level>            effort level for the session
  --workspace <path>          folder the agent works in (default: current folder)
  --permission-mode <mode>    ${permissionModeSchema.options.join(" | ")} (default: ask)

While it runs: answer a permission request with its number, type a follow-up
prompt after a turn ends, or press Enter on an empty line to stop.`;

interface PendingPermission {
  requestId: string;
  options: PermissionOption[];
}

function readOptions(): { prompt: string; options: SessionOptions } | undefined {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      harness: { type: "string", default: "claude" },
      model: { type: "string" },
      effort: { type: "string" },
      workspace: { type: "string" },
      "permission-mode": { type: "string", default: "ask" },
    },
  });
  const prompt = positionals.join(" ").trim();
  if (prompt === "") return undefined;
  return {
    prompt,
    options: {
      harness: values.harness,
      environment: { kind: "native" },
      permissionMode: permissionModeSchema.parse(values["permission-mode"]),
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.effort === undefined ? {} : { effort: values.effort }),
      ...(values.workspace === undefined ? {} : { workspacePath: values.workspace }),
    },
  };
}

async function main(): Promise<void> {
  const input = readOptions();
  if (input === undefined) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const session = createSession(input.options);
  const pending: PendingPermission[] = [];
  const terminal = createInterface({ input: process.stdin });
  let ended = false;

  const onEvent = (event: SessionEvent): void => {
    console.log(formatEvent(event));
    if (event.type === "permission.requested") pending.push(event.payload);
    if (event.type === "permission.resolved") {
      const index = pending.findIndex((p) => p.requestId === event.payload.requestId);
      if (index >= 0) pending.splice(index, 1);
    }
    if (event.type === "turn.ended") console.log("\nNext prompt (empty line to stop):");
    if (event.type === "session.ended") {
      ended = true;
      terminal.close();
    }
  };

  const onLine = async (line: string): Promise<void> => {
    const request = pending[0];
    if (request !== undefined) {
      const option = request.options[Number(line) - 1];
      if (option === undefined) {
        console.log(`Type a number from 1 to ${request.options.length}.`);
        return;
      }
      const { requestId } = request;
      await session.send({ type: "answerPermission", requestId, optionId: option.optionId });
      return;
    }
    if (line.trim() === "") await session.send({ type: "stop" });
    else await session.send({ type: "prompt", text: line });
  };

  session.subscribe(onEvent);
  terminal.on("line", (line) => {
    if (ended) return;
    onLine(line).catch((error: unknown) => console.error(error));
  });
  terminal.on("close", () => {
    if (!ended) session.send({ type: "stop" }).catch((error: unknown) => console.error(error));
  });

  await session.send({ type: "start" });
  if (!ended) await session.send({ type: "prompt", text: input.prompt });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
