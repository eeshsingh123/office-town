import type { DelegationRecord, MilestoneRecord } from "@office-town/contract";
import { z } from "zod";
import { NOT_YET, startWork, teamOf } from "../team/delegate.ts";
import { isOpen, leadsTeam } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { putQuestion } from "../tools/ask-user.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import {
  goalMilestones,
  isWorker,
  MILESTONES_NUDGE,
  milestoneLines,
  milestonesOn,
  ownsGoal,
  partMilestones,
  sendBackLimit,
} from "./record.ts";

const milestoneInput = z.object({
  outcome: z
    .string()
    .trim()
    .min(1)
    .describe("What the user gets, in one plain sentence with nothing technical in it."),
  see: z
    .string()
    .trim()
    .min(1)
    .describe("How the user would see it for themselves, in plain words."),
});

export const partMilestonesInput = z
  .array(milestoneInput)
  .optional()
  .describe(
    "With milestones on: what this part gives the user, each one outcome and how they would see it.",
  );

const ONCE_MORE = "Send back once more";
const AS_IS = "Accept as is";

const ordinal = (n: number) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;

// The worker's own part, the one it is on now or last finished.
function partOf(context: TeamContext, caller: Caller): DelegationRecord | undefined {
  const { store } = context;
  const working = store.workingDelegation(caller.sessionId);
  if (working !== undefined) return working;
  return store
    .listDelegations(caller.taskId)
    .findLast((one) => one.workerAgentId === caller.agentId);
}

function listReply(milestones: readonly MilestoneRecord[]): string {
  const nudge =
    milestones.length > MILESTONES_NUDGE
      ? `\n\nThat is ${milestones.length} milestones. Merge any that overlap, or move detail into the parts you hand out, so the user can follow the goal at a glance.`
      : "";
  return `The goal's milestones:\n${milestoneLines(milestones)}${nudge}`;
}

export function setMilestones(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "set_milestones",
    description:
      "Write down what the user will get from this goal, as milestones they can see and change. " +
      "Call it first, before any other work, with at least one. Give an id to reword one you " +
      "wrote to make it clearer; a new one has no id. Leaving one out does not remove it: to drop " +
      "one or ask for less, use propose_change.",
    input: z.object({
      milestones: z
        .array(milestoneInput.extend({ id: z.string().min(1).optional() }))
        .min(1)
        .describe("Each one outcome the user can see; an id such as M2 rewords that one."),
    }),
    offeredTo: (caller) => milestonesOn(store, caller.taskId) && ownsGoal(store, caller),
    call({ milestones }, caller) {
      const known = goalMilestones(store, caller.taskId);
      for (const { id, outcome, see } of milestones) {
        const earlier =
          id === undefined ? undefined : known.find((one) => one.key === id.toUpperCase());
        if (id !== undefined && earlier === undefined) {
          throw new ToolError(`There is no milestone ${id}. Leave out the id to add a new one.`);
        }
        if (earlier === undefined) {
          store.createMilestone({ taskId: caller.taskId, outcome, see, origin: "agent" });
        } else if (earlier.outcome !== outcome || earlier.see !== see) {
          store.updateMilestone(earlier.id, { outcome, see, changedBy: caller.agentId });
        }
      }
      return listReply(goalMilestones(store, caller.taskId));
    },
  });
}

export function reportMilestone(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "report_milestone",
    description:
      "Say whether one of your milestones is met, with what you did and saw. A worker reports " +
      "every milestone of its part before its final message; a lead reports the goal's own " +
      "once the work is put together. Report honestly: one not met is worth knowing.",
    input: z.object({
      id: z.string().min(1).describe("The milestone, such as M3."),
      met: z.boolean(),
      proof: z
        .string()
        .trim()
        .min(1)
        .describe("What you did to check it and what you saw, in a sentence or two."),
    }),
    offeredTo: (caller) =>
      milestonesOn(store, caller.taskId) && (ownsGoal(store, caller) || isWorker(store, caller)),
    call({ id, met, proof }, caller) {
      const milestone = store.milestoneByKey(caller.taskId, id);
      const worker = isWorker(store, caller);
      const part = worker ? partOf(context, caller) : undefined;
      const mine = worker
        ? part !== undefined && milestone?.delegationId === part.id
        : milestone !== undefined && milestone.delegationId === undefined;
      if (milestone === undefined || !mine) {
        const own =
          part === undefined ? goalMilestones(store, caller.taskId) : partMilestones(store, part);
        throw new ToolError(
          `${id} is not one of your milestones. Yours: ${own.map((one) => one.key).join(", ") || "none"}.`,
        );
      }
      store.updateMilestone(milestone.id, {
        status: met ? "met" : "not_met",
        proof,
        reportedBy: caller.agentId,
      });
      const left = (
        part === undefined ? goalMilestones(store, caller.taskId) : partMilestones(store, part)
      ).filter((one) => one.status === "not_started");
      return left.length === 0
        ? `Saved: ${milestone.key} ${met ? "met" : "not met"}. Every milestone is reported.`
        : `Saved: ${milestone.key} ${met ? "met" : "not met"}. Still to report: ${left.map((one) => one.key).join(", ")}.`;
    },
  });
}

// The lead's check loop, with a hard limit kept by the core: past it, the user decides (owner).
export class SendBacks {
  readonly #context: TeamContext;
  // Parts whose next send-back waits on the user.
  readonly #asking = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
  }

  tool() {
    const { store } = this.#context;
    return defineTool({
      name: "send_back",
      description:
        "Send a finished part back to its worker when milestones it reported are not met. The " +
        "worker gets only those milestones and your note. A part goes back at most twice; after " +
        "that the user decides. It returns at once; the result reaches you as a message.",
      input: z.object({
        agent: z.string().min(1).describe("The worker's name, such as @ben-1042."),
        milestones: z
          .array(z.string().min(1))
          .min(1)
          .describe("The part's milestones that are not met, such as M4."),
        note: z.string().trim().min(1).describe("What is wrong and what to fix, in a sentence."),
      }),
      offeredTo: (caller) => milestonesOn(store, caller.taskId) && leadsTeam(store, caller),
      call: (input, caller) => this.#sendBack(input, caller),
    });
  }

  async #sendBack(
    { agent, milestones, note }: { agent: string; milestones: string[]; note: string },
    caller: Caller,
  ): Promise<string> {
    const { store } = this.#context;
    const team = teamOf(this.#context, caller);
    if (team === undefined) throw new ToolError(NOT_YET);
    const worker = team.workers.find((member) => member.name === agent);
    if (worker === undefined) throw new ToolError(`${agent} is not on your team.`);
    const failing = milestones.map((key) => store.milestoneByKey(caller.taskId, key));
    const part = store
      .listDelegations(caller.taskId)
      .find((one) => one.id === failing[0]?.delegationId);
    if (
      part === undefined ||
      part.workerAgentId !== worker.id ||
      failing.some((one) => one?.delegationId !== part.id)
    ) {
      throw new ToolError(`Name milestones of one of ${worker.name}'s parts.`);
    }
    if (part.status === "working") {
      throw new ToolError(`${worker.name} is still on this part. Its result reaches you first.`);
    }
    const named = failing.flatMap((one) => one ?? []);
    if ((part.sendBacks?.length ?? 0) >= sendBackLimit(part)) {
      return this.#askUser(caller, part, worker.name, named, note);
    }
    return this.#send(caller, part, named, note);
  }

  async #send(
    caller: Caller,
    part: DelegationRecord,
    failing: MilestoneRecord[],
    note: string,
  ): Promise<string> {
    const { store } = this.#context;
    const team = teamOf(this.#context, caller);
    const worker = team?.workers.find((member) => member.id === part.workerAgentId);
    if (team === undefined || worker === undefined) throw new ToolError(NOT_YET);
    const earlier = store.listSessions(caller.taskId).findLast((one) => one.agentId === worker.id);
    if (earlier !== undefined && store.workingDelegation(earlier.id) !== undefined) {
      throw new ToolError(`${worker.name} is on another part. Send this back once that one ends.`);
    }
    const round = (part.sendBacks?.length ?? 0) + 1;
    const work = `${team.lead.name} sent your part back (${round} of ${sendBackLimit(part)}): ${note}

These milestones are not met yet:
${milestoneLines(failing)}

Work on these only. Report each one again with report_milestone, then end with a short account.`;
    const session = await startWork(this.#context, team, caller, worker, work, []);
    if (!isOpen(session))
      throw new ToolError(`${worker.name} could not start. Its trace says why.`);
    for (const milestone of failing) store.updateMilestone(milestone.id, { status: "not_met" });
    store.reopenDelegation(part.id, session.id, {
      note,
      milestones: failing.map((one) => one.key),
      proofs: failing.map((one) => one.proof ?? ""),
      at: new Date().toISOString(),
    });
    return `Sent back to ${worker.name} (${round} of ${sendBackLimit(part)}). Its result will reach you as a message.`;
  }

  #askUser(
    caller: Caller,
    part: DelegationRecord,
    workerName: string,
    failing: MilestoneRecord[],
    note: string,
  ): string {
    const { store, registry } = this.#context;
    if (this.#asking.has(part.id)) {
      return "This part is already with the user. Their answer will reach you as a message.";
    }
    this.#asking.add(part.id);
    const lead = store.getAgent(caller.agentId)?.name ?? "The lead";
    const name =
      part.title === undefined ? `${workerName}'s part` : `${workerName}'s "${part.title}"`;
    const tries = [
      ...(part.sendBacks ?? []),
      { note, proofs: failing.map((one) => one.proof ?? "") },
    ];
    const story = tries
      .map((attempt, index) => {
        const said = attempt.proofs.filter((proof) => proof !== "").join(" ");
        return `${ordinal(index + 1)} try: ${said === "" ? "nothing reported." : said} ${lead}: "${attempt.note}"`;
      })
      .join("\n");
    const sentBack = part.sendBacks?.length ?? 0;
    putQuestion(
      registry,
      caller.sessionId,
      {
        text: `${name} was sent back ${sentBack === 2 ? "twice" : `${sentBack} times`}, and ${lead} would send it back again. You decide.\n\nNot met:\n${failing.map((one) => `- ${one.outcome}`).join("\n")}\n\n${story}`,
        options: [
          { label: ONCE_MORE, description: `${workerName} gets ${lead}'s note and tries again.` },
          { label: AS_IS, description: "The part counts as done the way it is." },
        ],
        multiSelect: false,
      },
      (selected) => {
        this.#asking.delete(part.id);
        return this.#answer(caller, part, failing, note, selected, name);
      },
    );
    return `${name} was already sent back ${sentBack} times, so it is with the user now. Their answer will reach you as a message; carry on with other work meanwhile.`;
  }

  #answer(
    caller: Caller,
    part: DelegationRecord,
    failing: MilestoneRecord[],
    note: string,
    selected: string[],
    name: string,
  ): string {
    const [answer] = selected;
    if (selected.length === 1 && answer === ONCE_MORE) {
      this.#context.store.raiseSendBackLimit(part.id);
      const raised = this.#context.store
        .listDelegations(caller.taskId)
        .find((one) => one.id === part.id);
      this.#send(caller, raised ?? part, failing, note).catch((error: unknown) => {
        console.error(`Could not send ${name} back.`, error);
      });
      return `The user sent ${name} back once more, with your note. Its result will reach you as a message.`;
    }
    if (selected.length === 1 && answer === AS_IS) {
      return `The user accepted ${name} as it is. Do not send it back again; carry on with the goal.`;
    }
    return `The user answered about ${name} in their own words: ${selected.join(", ")}\nDo what they say.`;
  }
}

export const goalTools = (context: TeamContext) => [
  setMilestones(context),
  reportMilestone(context),
  new SendBacks(context).tool(),
];
