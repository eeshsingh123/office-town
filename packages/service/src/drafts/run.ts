import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionKind, RoleSettings, SessionEvent } from "@office-town/contract";
import type { Session } from "@office-town/harness";
import { type ZodType, z } from "zod";
import { chooseAccount } from "../accounts/accounts.ts";
import type { TeamContext } from "../team/members.ts";

const TIMEOUT_MS = 4 * 60 * 1000;

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

// The object may come inside a code fence or after a sentence.
function readJson<T>(text: string, schema: ZodType<T>): { value: T } | { problem: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return { problem: "there was no JSON object" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  const result = schema.safeParse(parsed);
  return result.success ? { value: result.data } : { problem: z.prettifyError(result.error) };
}

// A draft needs no tools beyond those allowed, so anything else the model tries is refused.
function refuse(session: Session, event: SessionEvent, allowed: readonly ActionKind[]): void {
  if (event.type !== "permission.requested") return;
  const { kind } = event.payload;
  const allow = kind !== undefined && allowed.includes(kind);
  const option = event.payload.options.find((each) =>
    allow ? each.kind === "allow_once" : each.kind.startsWith("reject"),
  );
  if (option === undefined) return;
  const { requestId } = event.payload;
  void session.send({ type: "answerPermission", requestId, optionId: option.optionId });
}

// One short run outside any task: nothing is stored, and the session ends with the reply.
export function askForJson<T>(
  { store, dataFolder, createSession }: TeamContext,
  drafter: RoleSettings,
  prompt: string,
  schema: ZodType<T>,
  // Such as web search and fetch, for a draft that looks things up (D-67).
  allowed: readonly ActionKind[] = [],
): Promise<T> {
  const folder = join(dataFolder, "drafts");
  mkdirSync(folder, { recursive: true });
  const session = createSession(
    {
      ...drafter,
      ...chooseAccount(store, drafter),
      permissionMode: "ask",
      isolated: true,
      workspacePath: folder,
    },
    {},
  );
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  let reply = "";
  let retried = false;
  let settled = false;
  const finish = (settle: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unsubscribe();
    settle();
    void session.send({ type: "stop" }).catch(() => undefined);
  };
  const fail = (message: string) => finish(() => reject(new DraftError(message)));
  const timer = setTimeout(
    () => fail("The draft took too long. Try again, or pick a faster model."),
    TIMEOUT_MS,
  );
  const unsubscribe = session.subscribe((event) => {
    refuse(session, event, allowed);
    if (event.type === "message" && event.payload.role === "assistant") reply = event.payload.text;
    if (event.type === "session.ended") fail("The AI app stopped before the draft was ready.");
    if (event.type !== "turn.ended") return;
    if (event.payload.outcome !== "completed") return fail("The draft could not be written.");
    const read = readJson(reply, schema);
    if ("value" in read) return finish(() => resolve(read.value));
    if (retried) return fail("The model did not reply with a usable draft. Try again.");
    retried = true;
    const text = `That reply was not the JSON object asked for (${read.problem}). Reply with the JSON object only.`;
    void session.send({ type: "prompt", text }).catch((error: unknown) => fail(String(error)));
  });
  session
    .send({ type: "start" })
    .then(() => (settled ? undefined : session.send({ type: "prompt", text: prompt })))
    .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  return promise;
}
