import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentRecord,
  type CheckItem,
  type CheckRecord,
  type CheckRequest,
  type CheckResult,
  type EnvironmentSpec,
  lowerAutonomy,
  type TaskChecklist,
} from "@office-town/contract";
import { environmentPath } from "@office-town/harness";
import { z } from "zod";
import { createAgent } from "../agents/agents.ts";
import { instructionsFor } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { levelOf } from "../autonomy/policy.ts";
import { isChiefTask } from "../chief/chief.ts";
import {
  AnswerError,
  type CoreRequestHandler,
  type Message,
} from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { type MadeSandbox, makeSandbox, removeSandbox } from "./check-sandbox.ts";
import { eventsOf, transcriptOf, userMessages } from "./handover.ts";
import { isOpen, latestSession } from "./lead.ts";
import { type TeamContext, TeamError } from "./members.ts";

const OPEN = new Set<CheckRecord["status"]>(["drafting", "approving", "running"]);
const MAX_ITEMS = 60;

const itemInput = z.object({
  check: z.string().trim().min(1).describe("What to do: a command to run, or steps in the app."),
  expected: z.string().trim().min(1).describe("What a pass looks like, specific enough to judge."),
});

// The lead, or a solo task's agent; never the chief, a worker or a checker.
function topAgentOf(store: Store, taskId: string): string | undefined {
  if (isChiefTask(store, taskId)) return undefined;
  return store.getTask(taskId)?.leadAgentId ?? store.listSessions(taskId)[0]?.agentId;
}

// The agent named, such as a worker in its own worktree, else the task's lead or solo agent.
function ownerOf(store: Store, taskId: string, agentId: string | undefined): string {
  const owner = agentId ?? topAgentOf(store, taskId);
  if (owner === undefined) throw new RecordNotFoundError("task", taskId);
  return owner;
}

// From round 2 on the list stays as approved, unless the owner wrote a newer checklist since.
function approvedBefore(store: Store, taskId: string): CheckRecord | undefined {
  const last = store.listChecks(taskId).findLast((check) => check.items.length > 0);
  const written = store.getTask(taskId)?.checklist?.writtenAt;
  if (last === undefined || (written !== undefined && written > last.createdAt)) return undefined;
  return last;
}

const numbered = (items: CheckItem[]) =>
  items.map((item) => `- [${item.id}] ${item.check}\n  Expected: ${item.expected}`).join("\n");

function section(title: string, body: string | undefined): string {
  const text = body?.trim() ?? "";
  return text === "" ? "" : `\n\n${title}:\n${text}`;
}

interface Background {
  owner: AgentRecord;
  // The owner's checklist, when it wrote one for this task.
  checklist: TaskChecklist | undefined;
  text: string;
  transcript: string;
}

// Everything the records hold about the work, so the checker needs no one's memory (owner, D-73).
function backgroundOf(store: Store, taskId: string, owner: AgentRecord): Background {
  const task = store.getTask(taskId);
  if (task === undefined) throw new RecordNotFoundError("task", taskId);
  const parent = task.parentTaskId === undefined ? undefined : store.getTask(task.parentTaskId);
  const sessions = store.listSessions(taskId).filter((session) => session.agentId === owner.id);
  const events = sessions.map((session) => eventsOf(store, session.id));
  const said = userMessages(events.flat()).flatMap(({ text, origin }) => {
    if (origin === undefined) return [`- ${text}`];
    if (origin.kind === "answer") return [`- Answering a question: ${text}`];
    return [];
  });
  const pieces = store.listDelegations(taskId).map((delegation) => {
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const result = delegation.result ? `\n  Result: ${delegation.result}` : "";
    return `- ${name}, ${delegation.status}:\n  Brief: ${delegation.brief}${result}`;
  });
  const last = sessions.at(-1);
  const account = last === undefined ? undefined : store.lastMessage(last.id);
  const checklist = topAgentOf(store, taskId) === owner.id ? task.checklist : undefined;
  const text = [
    section("The goal", task.prompt),
    section("The larger goal it is part of", parent?.prompt),
    section("What the user said", said.join("\n")),
    section("Work handed out, with results", pieces.join("\n")),
    section(`${owner.name}'s final account`, account),
    section(`How to set up and run it, from ${owner.name}`, checklist?.setup),
    section(`What changed, from ${owner.name}`, checklist?.changes),
  ].join("");
  return { owner, checklist, text, transcript: transcriptOf(events, owner.name) };
}

interface Place {
  made: MadeSandbox;
  seen: (path: string) => string;
}

function opening({ made, seen }: Place, background: Background, transcriptFile: string): string {
  const { owner } = background;
  const where =
    made.kind === "worktree"
      ? `${seen(made.workPath)}: a temporary git worktree of ${owner.name}'s folder, with its uncommitted changes. Install, build and run whatever you need there. Never commit, push or change branches.`
      : `${seen(made.workPath)}: a temporary copy of ${owner.name}'s folder, without .git and node_modules. Install what you need there; if an item still cannot run, mark it not_run and say why.`;
  return `You check finished work in Office Town, an app where AI agents work for the user. You did not build it, and that is the point: check it fresh and honestly. Your answer goes to the user, not to the team.

The work is in ${where} It is removed when you finish, and changing it changes nothing else.${background.text}

${owner.name}'s whole conversation is in ${seen(transcriptFile)}. Search it for a detail you need; do not read it whole.`;
}

const RUN = `Run every item. For each, record pass, fail or not_run, with evidence: what you ran or did and the key output. A fail also needs the steps to reproduce it and what happened instead. Something you notice that is not on the list goes into notes; it does not fail the check. Keep command output short: quiet flags, and long output into a file you search. When every item has a result, call report_check, then end your turn with one line.`;

function draftBrief(place: Place, background: Background, file: string, ask: string | undefined) {
  const { owner, checklist } = background;
  const given =
    checklist === undefined
      ? `${owner.name} wrote no checklist, so write the whole list yourself.`
      : `${owner.name}'s checklist:\n${checklist.items.map((item) => `- ${item.check}\n  Expected: ${item.expected}`).join("\n")}`;
  const text = `${opening(place, background, file)}

${given}${section("The user also asks", ask)}

First, write the checklist you will run; do not run anything yet. Keep ${owner.name}'s items and add what they miss: the expected scenario end to end, edge cases, boundary values, empty or wrong input, and error paths. Each item is one check with the result it expects, specific enough that anyone gets the same answer. Look at the work only as much as you need for that. Call propose_checks with the full list, then end your turn. The user edits and approves it, and the approved list reaches you as a message.`;
  return { text, origin: { kind: "brief", summary: `Check ${owner.name}'s work` } } as const;
}

function againBrief(
  place: Place,
  background: Background,
  file: string,
  earlier: CheckRecord,
  ask: string | undefined,
) {
  const results = new Map(earlier.results?.map((result) => [result.id, result]));
  const before = earlier.items.map((item) => {
    const result = results.get(item.id);
    return `- [${item.id}] ${result?.outcome ?? "no result"}${result?.got ? `: ${result.got}` : ""}`;
  });
  const text = `${opening(place, background, file)}

This is round ${earlier.round + 1}. In round ${earlier.round}:
${before.join("\n")}
The team was asked to fix what failed; its final account above says what it did.${section("The user also asks", ask)}

The checklist the user approved, which does not change:
${numbered(earlier.items)}

Check every item again, not only those that failed: a fix can break what passed. ${RUN}`;
  return {
    text,
    origin: { kind: "brief", summary: `Check ${background.owner.name}'s work again` },
  } as const;
}

function resultsOf(items: CheckItem[], given: CheckResult[]): CheckResult[] {
  const byId = new Map<string, CheckResult>();
  for (const result of given) {
    if (byId.has(result.id)) throw new ToolError(`${result.id} has two results; give one.`);
    byId.set(result.id, result);
  }
  const known = new Set(items.map((item) => item.id));
  const unknown = [...byId.keys()].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ToolError(
      `Not on the approved list: ${unknown.join(", ")}. Put such findings in notes.`,
    );
  }
  const missing = items.filter((item) => !byId.has(item.id)).map((item) => item.id);
  if (missing.length > 0) throw new ToolError(`No result yet for ${missing.join(", ")}.`);
  const vague = given
    .filter((result) => result.outcome === "fail" && (!result.steps?.trim() || !result.got?.trim()))
    .map((result) => result.id);
  if (vague.length > 0) {
    throw new ToolError(
      `A fail needs the steps to reproduce it and what happened instead: ${vague.join(", ")}.`,
    );
  }
  return items.map((item) => byId.get(item.id) as CheckResult);
}

// One check of a task at a time; the user starts every round (D-73).
export class Checks {
  readonly #context: TeamContext;
  // A check between its session's start and its record, so an early tool call still finds it.
  readonly #starting = new Map<string, Promise<CheckRecord>>();
  // A checker is reminded once to call the tool its step owes.
  readonly #reminded = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => {
      if (event.type === "turn.ended") {
        // After every listener ran, so the turn's own records are in.
        queueMicrotask(() => {
          this.#afterTurn(event.sessionId).catch((error: unknown) => {
            console.error("Could not move a check on.", error);
          });
        });
      }
      if (event.type === "session.ended") {
        this.#ended(event.sessionId, event.payload.reason).catch((error: unknown) => {
          console.error("Could not close a check.", error);
        });
      }
    });
  }

  async start(taskId: string, request: CheckRequest): Promise<CheckRecord> {
    const { store, dataFolder } = this.#context;
    if (store.listChecks(taskId).some((check) => OPEN.has(check.status))) {
      throw new TeamError("A check of this work is already under way.");
    }
    const ownerAgentId = ownerOf(store, taskId, request.agentId);
    const owner = store.getAgent(ownerAgentId);
    const main = latestSession(this.#context, taskId, ownerAgentId)?.options.workspacePath;
    if (owner === undefined) throw new RecordNotFoundError("agent", ownerAgentId);
    if (main === undefined) throw new TeamError("This work has no folder to check.");
    const earlier = approvedBefore(store, taskId);
    // A checker works only in its sandbox, so it never needs more than Full.
    const autonomy = lowerAutonomy(levelOf(store, owner.id), "full");
    const checker = createAgent(store, request.reviewer, {
      role: "Checker",
      autonomy,
      guest: true,
    });
    const { environment } = checker.settings;
    let made: MadeSandbox;
    try {
      made = await makeSandbox(dataFolder, main, environment);
    } catch (error) {
      store.deleteAgentIfUnused(checker.id);
      throw error;
    }
    try {
      return await this.#launch({ taskId, owner, checker, environment, made, earlier, request });
    } catch (error) {
      await removeSandbox(made.record);
      store.deleteAgentIfUnused(checker.id);
      throw error;
    }
  }

  async #launch(given: {
    taskId: string;
    owner: AgentRecord;
    checker: AgentRecord;
    environment: EnvironmentSpec;
    made: MadeSandbox;
    earlier: CheckRecord | undefined;
    request: CheckRequest;
  }): Promise<CheckRecord> {
    const { store, registry } = this.#context;
    const { taskId, owner, checker, made, earlier, request } = given;
    const background = backgroundOf(store, taskId, owner);
    const file = join(made.contextPath, "conversation.md");
    await writeFile(file, background.transcript);
    const place = { made, seen: (path: string) => environmentPath(given.environment, path) };
    const instructions = instructionsFor(store, checker);
    const brief =
      earlier === undefined
        ? draftBrief(place, background, file, request.ask)
        : againBrief(place, background, file, earlier, request.ask);
    const message: Message = {
      ...brief,
      text: instructions === undefined ? brief.text : `${instructions}\n\n${brief.text}`,
    };
    const record = registry
      .start({
        taskId,
        agentId: checker.id,
        options: {
          ...sessionOptionsFor(store, checker, {
            workspacePath: made.workPath,
            readOnlyPaths: [made.contextPath],
          }),
          isolated: true,
        },
        message,
      })
      .then((session) =>
        store.createCheck(
          {
            taskId,
            round: (earlier?.round ?? 0) + 1,
            status: earlier === undefined ? "drafting" : "running",
            checkerAgentId: checker.id,
            checkerSessionId: session.id,
            ownerAgentId: owner.id,
            sandbox: made.kind,
            items: earlier?.items ?? [],
          },
          made.record,
        ),
      );
    this.#starting.set(checker.id, record);
    try {
      const check = await record;
      // A checker that could not start has already ended, before its record existed.
      const session = store.getSession(check.checkerSessionId);
      if (session !== undefined && !isOpen(session)) await this.#ended(session.id, "failed");
      return store.getCheck(check.id) ?? check;
    } finally {
      this.#starting.delete(checker.id);
    }
  }

  async #checkOf(caller: Caller): Promise<CheckRecord> {
    const check =
      this.#context.store.checkOfSession(caller.sessionId) ??
      (await this.#starting.get(caller.agentId));
    if (check === undefined) throw new ToolError("You are not checking any work.");
    return check;
  }

  // Every guest is a checker; its step decides what it may do.
  #isChecker = (caller: Caller) => this.#context.store.getAgent(caller.agentId)?.guest === true;

  writeChecklistTool() {
    const { store } = this.#context;
    return defineTool({
      name: "write_checklist",
      description:
        "Once your work is done, write the checklist a fresh agent outside your team runs when " +
        "the user sends the work for a check: each item a check with the result it expects, how " +
        "to set up and run the work, and what changed. Write it before your final message; " +
        "writing it again replaces it.",
      input: z.object({
        items: z.array(itemInput).min(1).max(MAX_ITEMS),
        setup: z.string().trim().min(1).describe("How to install, build, run and test it."),
        changes: z.string().trim().min(1).describe("What was built or changed, and where."),
      }),
      offeredTo: (caller: Caller) =>
        topAgentOf(store, caller.taskId) === caller.agentId &&
        store.getTask(caller.taskId)?.workspaceId !== undefined,
      call({ items, setup, changes }, caller) {
        store.setTaskChecklist(caller.taskId, {
          items,
          setup,
          changes,
          agentId: caller.agentId,
          writtenAt: new Date().toISOString(),
        });
        return "Saved. The user sees it when they send the work for a check.";
      },
    });
  }

  proposeChecksTool() {
    const { store, registry } = this.#context;
    return defineTool({
      name: "propose_checks",
      description:
        "Send the user the full checklist you will run: the items you were given and the cases " +
        "you add. The user edits and approves it, and the approved list reaches you as a " +
        "message. End your turn after calling it.",
      input: z.object({
        items: z
          .array(
            itemInput.extend({
              fromLead: z
                .boolean()
                .optional()
                .describe("True for an item taken from the checklist you were given."),
            }),
          )
          .min(1)
          .max(MAX_ITEMS),
      }),
      offeredTo: this.#isChecker,
      call: async ({ items }, caller) => {
        const check = await this.#checkOf(caller);
        if (check.status !== "drafting") {
          throw new ToolError(
            check.status === "approving"
              ? "Your checklist is already with the user."
              : "Your checklist is already approved; run it.",
          );
        }
        const proposed: CheckItem[] = items.map(({ check: text, expected, fromLead }, index) => ({
          id: `c${index + 1}`,
          check: text,
          expected,
          from: fromLead === true ? "lead" : "checker",
        }));
        const requestId = `checklist-${randomUUID()}`;
        store.updateCheck(check.id, { status: "approving" });
        registry.ask(
          caller.sessionId,
          {
            type: "checklist.requested",
            payload: { requestId, checkId: check.id, items: proposed },
          },
          this.#answer(check.id, caller.sessionId, requestId),
        );
        return "Your checklist is with the user. End your turn now; the approved list reaches you as a message.";
      },
    });
  }

  #answer(checkId: string, sessionId: string, requestId: string): CoreRequestHandler {
    const { store, registry } = this.#context;
    return (command) => {
      if (command.type !== "answerChecklist") throw new AnswerError("This is a checklist.");
      const { answer } = command;
      if (answer.outcome === "declined") {
        store.updateCheck(checkId, { status: "stopped" });
        return {
          resolution: { type: "checklist.resolved", payload: { requestId, outcome: "declined" } },
          afterwards: () => registry.stop(sessionId, true),
        };
      }
      const ids = new Set(answer.items.map((item) => item.id));
      if (ids.size !== answer.items.length) throw new AnswerError("Two items share an id.");
      store.updateCheck(checkId, { status: "running", items: answer.items });
      return {
        resolution: {
          type: "checklist.resolved",
          payload: { requestId, outcome: "approved", items: answer.items },
        },
        afterwards: () =>
          registry.tell(sessionId, {
            text: `The user approved this checklist of ${answer.items.length} items. It does not change from here.\n${numbered(answer.items)}\n\n${RUN}`,
            origin: { kind: "answer", requestId },
          }),
      };
    };
  }

  reportCheckTool() {
    const { store } = this.#context;
    return defineTool({
      name: "report_check",
      description:
        "Record the result of every item on the approved checklist, then end your turn. A fail " +
        "needs the steps to reproduce it and what happened instead.",
      input: z.object({
        results: z
          .array(
            z.object({
              id: z.string().min(1).describe("The item's id, such as c3."),
              outcome: z.enum(["pass", "fail", "not_run"]),
              evidence: z
                .string()
                .trim()
                .min(1)
                .describe("What you ran or did, and the key output."),
              steps: z.string().optional().describe("For a fail: the steps to reproduce it."),
              got: z.string().optional().describe("For a fail: what happened instead."),
            }),
          )
          .min(1),
        notes: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("What you noticed outside the list; it does not fail the check."),
      }),
      offeredTo: this.#isChecker,
      call: async ({ results, notes }, caller) => {
        const check = await this.#checkOf(caller);
        if (check.status !== "running") {
          throw new ToolError(
            check.status === "done"
              ? "Your results are already recorded."
              : "The user has not approved your checklist yet.",
          );
        }
        store.updateCheck(check.id, {
          status: "done",
          results: resultsOf(check.items, results),
          ...(notes === undefined || notes.length === 0 ? {} : { notes }),
        });
        return "Recorded. End your turn now with one line.";
      },
    });
  }

  // A checker that ends its turn owing its tool is reminded once; one with nothing left leaves.
  async #afterTurn(sessionId: string): Promise<void> {
    const { store, registry } = this.#context;
    const check = store.checkOfSession(sessionId);
    if (check === undefined || !registry.isRunning(sessionId)) return;
    const waiting = store
      .listPendingRequests()
      .requests.some(({ event }) => event.sessionId === sessionId);
    if (waiting || store.owesTurn(sessionId)) return;
    const owed =
      check.status === "drafting"
        ? "propose_checks"
        : check.status === "running"
          ? "report_check"
          : undefined;
    if (owed !== undefined && !this.#reminded.has(sessionId)) {
      this.#reminded.add(sessionId);
      await registry.tell(sessionId, {
        text: `You have not called ${owed} yet. Call it now, then end your turn.`,
        origin: { kind: "notice", summary: `A reminder to call ${owed}` },
      });
      return;
    }
    await registry.stop(sessionId, true);
  }

  // However the checker ends, its sandbox goes (owner: no leftovers).
  async #ended(sessionId: string, reason: "stopped" | "exited" | "failed"): Promise<void> {
    const { store } = this.#context;
    const check = store.checkOfSession(sessionId);
    if (check === undefined) return;
    this.#reminded.delete(sessionId);
    if (OPEN.has(check.status)) {
      store.updateCheck(check.id, { status: reason === "failed" ? "failed" : "stopped" });
    }
    const left = store.checkSandboxes(check.taskId).find(({ checkId }) => checkId === check.id);
    if (left === undefined) return;
    await removeSandbox(left.sandbox);
    store.sandboxRemoved(check.id);
  }
}
