import type { HarnessDescription, HarnessModel } from "@office-town/contract";
import type { Message } from "../registry/session-registry.ts";

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

function where(folders: string[]): string {
  const [first, ...others] = folders;
  if (others.length === 0) return `You work in ${first}.`;
  return `You work in ${first}, and may use ${others.join(", ")} as freely.`;
}

function instructionsOf(instructions: string | undefined): string {
  const text = instructions?.trim() ?? "";
  return text === "" ? "" : `Your own instructions:\n${text}\n\n`;
}

export function proposeTeamBrief(input: {
  goal: string;
  folders: string[];
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

export function leadBrief(input: {
  goal: string;
  teamName: string;
  folders: string[];
  instructions: string | undefined;
  roster: string;
}): Message {
  const text = `You lead ${input.teamName} in Office Town, an app where a team of AI agents works on a goal for the user. Each worker runs in its own harness and session; you hand them work and put their results together.

${instructionsOf(input.instructions)}The goal:
${input.goal}

${where(input.folders)}

Your team:
${input.roster}

Hand each worker its piece with the delegate tool: name the worker and give it a brief it can act on alone, as it knows nothing else. Workers run at the same time. Each one's result reaches you as a message when it finishes; check on everyone with team_status. Do the rest yourself, then put the results together.

If the team needs to change, propose the whole new team with propose_team. If you cannot go on without the user's decision, ask with the ask_user tool.`;
  return { text, origin: { kind: "brief", summary: "The goal and your team" } };
}
