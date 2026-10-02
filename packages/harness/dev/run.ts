import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  type PermissionOption,
  permissionModeSchema,
  type Question,
  type QuestionAnswer,
  type SessionEvent,
  type SessionOptions,
} from "@office-town/contract";
import { createSession, listHarnesses } from "../src/index.ts";
import { formatEvent } from "./format.ts";

const USAGE = `Usage: pnpm dev:run "<prompt>" [options]

  --harness <name>            ${listHarnesses()
    .map((description) => description.harness)
    .join(" | ")} (default: claude)
  --model <name>              model for the session
  --effort <level>            effort level for the session
  --workspace <path>          folder the agent works in (default: current folder)
  --wsl <distro>              run the harness inside this WSL distro
  --permission-mode <mode>    ${permissionModeSchema.options.join(" | ")} (default: ask)
  --resume <session id>       continue an earlier session, by the id printed when it started

While it runs: answer a permission request or a question with its number, type a follow-up
prompt after a turn ends, or press Enter on an empty line to stop.`;

interface PendingPermission {
  requestId: string;
  options: PermissionOption[];
}

interface PendingQuestion {
  requestId: string;
  questions: Question[];
  answers: QuestionAnswer[];
}

// Numbers pick options ("2" or "1,3"); anything else is taken as the user's own answer.
function readAnswer(line: string, question: Question): string[] {
  const picks = line.split(",").map((part) => question.options[Number(part) - 1]?.label);
  return picks.every((label) => label !== undefined) ? picks : [line.trim()];
}

function readOptions(): { prompt: string; options: SessionOptions } | undefined {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      harness: { type: "string", default: "claude" },
      model: { type: "string" },
      effort: { type: "string" },
      workspace: { type: "string" },
      wsl: { type: "string" },
      "permission-mode": { type: "string", default: "ask" },
      resume: { type: "string" },
    },
  });
  const prompt = positionals.join(" ").trim();
  if (prompt === "") return undefined;
  return {
    prompt,
    options: {
      harness: values.harness,
      environment:
        values.wsl === undefined ? { kind: "native" } : { kind: "wsl", distro: values.wsl },
      permissionMode: permissionModeSchema.parse(values["permission-mode"]),
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.effort === undefined ? {} : { effort: values.effort }),
      ...(values.workspace === undefined ? {} : { workspacePath: values.workspace }),
      ...(values.resume === undefined ? {} : { resumeSessionId: values.resume }),
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
  const pendingQuestions: PendingQuestion[] = [];
  const terminal = createInterface({ input: process.stdin });
  let ended = false;

  const onEvent = (event: SessionEvent): void => {
    const line = formatEvent(event);
    if (line !== undefined) console.log(line);
    if (event.type === "permission.requested") pending.push(event.payload);
    if (event.type === "permission.resolved") {
      const index = pending.findIndex((p) => p.requestId === event.payload.requestId);
      if (index >= 0) pending.splice(index, 1);
    }
    if (event.type === "question.requested") {
      pendingQuestions.push({ ...event.payload, answers: [] });
    }
    if (event.type === "question.resolved") {
      const index = pendingQuestions.findIndex((q) => q.requestId === event.payload.requestId);
      if (index >= 0) pendingQuestions.splice(index, 1);
    }
    if (event.type === "turn.ended") console.log("\nNext prompt (empty line to stop):");
    if (event.type === "session.ended") {
      ended = true;
      terminal.close();
    }
  };

  const answerQuestion = async (asked: PendingQuestion, line: string): Promise<void> => {
    const question = asked.questions[asked.answers.length];
    if (question === undefined || line.trim() === "") {
      console.log("Type an option number, or your own answer.");
      return;
    }
    asked.answers.push({ questionId: question.questionId, selected: readAnswer(line, question) });
    if (asked.answers.length < asked.questions.length) return;
    const { requestId, answers } = asked;
    await session.send({ type: "answerQuestion", requestId, answers });
  };

  const onLine = async (line: string): Promise<void> => {
    const asked = pendingQuestions[0];
    if (asked !== undefined) return answerQuestion(asked, line);
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
