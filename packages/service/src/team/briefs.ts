import type { HarnessDescription, HarnessModel } from "@office-town/contract";
import { SHOW_ASK } from "../agents/briefs.ts";
import type { Message } from "../registry/session-registry.ts";
import type { TaskFolders } from "../task-folders.ts";

// Enough for the lead to choose from; propose_team names the valid ones if it picks another.
const MODELS_LISTED = 12;

export interface HarnessChoices {
  harness: HarnessDescription;
  models: HarnessModel[];
}

function modelLine(model: HarnessModel): string {
  const cost = model.access === undefined ? "" : ` (${model.access})`;
  const efforts = model.efforts.length === 0 ? "" : `, effort ${model.efforts.join("/")}`;
  return `${model.id}${cost}${efforts}`;
}

// Free and plan models first: a team should be reachable without paying per use (D-7).
export function describeChoices(choices: HarnessChoices[]): string {
  const rank = (model: HarnessModel) => ["free", "plan"].indexOf(model.access ?? "") + 1 || 3;
  return choices
    .map(({ harness, models }) => {
      const sorted = models.toSorted((a, b) => rank(a) - rank(b));
      const shown = sorted.slice(0, MODELS_LISTED).map(modelLine).join("; ");
      const more = sorted.length - MODELS_LISTED;
      return `- ${harness.name} (harness "${harness.harness}"): ${shown}${more > 0 ? `; and ${more} more` : ""}`;
    })
    .join("\n");
}

function where({ workspacePath, additionalPaths, readOnlyPaths }: TaskFolders): string {
  const also =
    additionalPaths.length === 0 ? "" : `, and may use ${additionalPaths.join(", ")} as freely`;
  const read =
    readOnlyPaths.length === 0
      ? ""
      : ` You may read ${readOnlyPaths.join(", ")}, but never change them.`;
  return `You work in ${workspacePath}${also}.${read}`;
}

// Whatever an agent reads is read again at each of its later steps, so long output is costly.
const QUIET_OUTPUT =
  "Keep command output short: quiet flags for tests and builds, and long output into a file you search.";

// A worker's result stays in the lead's conversation, so details go in a file the lead opens if needed.
const RESULT_ASK =
  "End with a short account in under 200 words: what you did, where it is, what you checked and how it went, and anything the lead must decide. Put longer findings in a file and give its path.";

function instructionsOf(instructions: string | undefined): string {
  const text = instructions?.trim() ?? "";
  return text === "" ? "" : `${text}\n\n`;
}

export function proposeTeamBrief(input: {
  goal: string;
  folders: TaskFolders;
  instructions: string | undefined;
  choices: HarnessChoices[];
}): Message {
  const text = `You lead a new team in Office Town, an app where a team of AI agents works on a goal for the user. Each worker runs in its own harness and session; you hand them work and put their results together.

${instructionsOf(input.instructions)}The goal:
${input.goal}

${where(input.folders)}

Your first step is to propose your team. Look at the workspace just enough to judge the work, then call the propose_team tool with a short name for the team and the workers you need: one per distinct piece of work, each with a role, what it does, a harness and a model from the list below. Prefer free models for routine work. The user edits and approves the team, and you get a message when they answer. Do not start the work before then.

Harnesses and models on this computer:
${describeChoices(input.choices)}

If you cannot go on without the user's decision, ask with the ask_user tool.`;
  return {
    text,
    origin: { kind: "brief", summary: "The goal, the workspace, and how to propose a team" },
  };
}

export function workerBrief(input: {
  goal: string;
  teamName: string;
  role: string;
  lead: { id: string; name: string };
  folders: TaskFolders;
  branch: string | undefined;
  instructions: string | undefined;
  work: string;
}): Message {
  const where_ =
    input.branch === undefined
      ? where(input.folders)
      : `${where(input.folders)} It is your own git worktree, on the branch ${input.branch}. Commit your work there before you finish; your lead merges it. Do not merge or push.`;
  const text = `You are the ${input.role} in ${input.teamName}, a team of AI agents in Office Town. Your lead, ${input.lead.name}, hands you a piece of work. When you finish, your last message goes to the lead as your result. ${RESULT_ASK}

${instructionsOf(input.instructions)}The team's goal:
${input.goal}

${where_}

Your piece of work, from ${input.lead.name}:
${input.work}

Before you finish, check your own piece: it builds and its own tests pass. ${QUIET_OUTPUT} ${SHOW_ASK} If you cannot go on without the user's decision, ask with the ask_user tool.`;
  return {
    text,
    origin: { kind: "brief", summary: `Work from ${input.lead.name}`, from: input.lead.id },
  };
}

// A worker that already has the team's brief gets only the new piece.
export function nextWork(lead: { id: string; name: string }, work: string): Message {
  return {
    text: `A new piece of work from ${lead.name}:
${work}

If you work on a branch of your own, commit your work there. ${RESULT_ASK}`,
    origin: { kind: "brief", summary: `New work from ${lead.name}`, from: lead.id },
  };
}

export const LEAD_BRIEF_SUMMARY = "The goal and your team";

export function leadBrief(input: {
  goal: string;
  teamName: string;
  folders: TaskFolders;
  instructions: string | undefined;
  roster: string;
  // Whether the lead also commits, pushes and opens a pull request.
  branches: boolean;
  codeFlow: boolean;
  // A group the user picked cannot be changed by its lead.
  fixedTeam?: boolean;
}): Message {
  const branches = input.branches
    ? "\n\nThis workspace is a git repository, and each worker works on a branch of its own, made from your branch's last commit: commit what a worker needs before you hand out its piece. When a worker's result says its work is committed, merge its branch into yours."
    : "";
  const codeFlow = input.codeFlow
    ? "\n\nWhen the goal is done, commit your work, push your branch and open a pull request with the gh command; they use the user's own git and GitHub logins."
    : "";
  const change = input.fixedTeam
    ? "The user picked this team for this task, so it cannot change."
    : "If the team needs to change, propose the whole new team with propose_team.";
  const text = `You lead ${input.teamName} in Office Town, an app where a team of AI agents works on a goal for the user. Each worker runs in its own harness and session; you hand them work and put their results together.

${instructionsOf(input.instructions)}The goal:
${input.goal}

${where(input.folders)}

Your team:
${input.roster}

Hand each worker its piece with the delegate tool: name the worker and give it a brief it can act on alone, as it knows nothing else. Workers run at the same time. Each one's result reaches you as a message when it finishes; check on everyone with team_status. Let workers take the time hard work needs. Only if one clearly goes beyond its piece, or the user asks, ask the user to stop it with stop_work; resume_work has it carry on.

Results and messages reach you by themselves. Never wait for them with sleep, by polling team_status or by watching for files: if you have nothing else to do, end your turn with a short line, and the next message wakes you. Read every message from the user and answer it first.

A failed turn was already tried again once. When a worker still fails, its message gives the reason. Look at it first, then fix it: if it looks temporary, have it carry on with resume_work; if its model or AI app refused the work, move it to another model with change_worker and then call resume_work; or hand the piece to another worker with delegate. Do the piece yourself only when none of these works, and tell the user why. If only the user can fix it, ask with ask_user.

You plan, decide and put the results together; your workers do the work. Everything you read stays in your conversation and is read again at each of your later steps, so keep it small:
- Look at the workspace only enough to plan. For a deeper look, have a worker study it and report briefly.
- Write the shared contracts every worker builds on (interfaces, schemas, a spec) yourself when the work needs them. Hand the building to workers.
- Check a result from its account and a diff summary, and open a file only where something looks wrong.
- Each worker checks its own piece: it builds and its own tests pass. You check that the merged work builds and its tests pass. A tester on the team checks a piece once and reports; you decide what must be fixed and hand that out once. Do not run rounds of testing and fixing: the end-to-end check comes after, outside the team.
- Fix small things yourself, such as a merge conflict or a line or two.
- The app shows the user every worker's state, so do not keep a progress board or commit only to record progress.
- When the goal is done, call write_checklist before your final message: what to check, each with the result it expects, how to set up and run the work, and what changed. The user can have a fresh agent outside the team run it.
- ${SHOW_ASK}
- ${QUIET_OUTPUT}${branches}${codeFlow}

${change} If the user asks you to carry on in a fresh session, call hand_over. If you cannot go on without the user's decision, ask with the ask_user tool.`;
  return { text, origin: { kind: "brief", summary: LEAD_BRIEF_SUMMARY } };
}
