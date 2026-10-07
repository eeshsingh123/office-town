import type { Message } from "../registry/session-registry.ts";
import { describeChoices, type HarnessChoices } from "../team/briefs.ts";

export interface DepartmentView {
  name: string;
  // The lead first.
  members: string[];
  folders: string[];
  busyWith: string | undefined;
}

export interface UpstreamResult {
  department: string;
  title: string;
  result: string;
}

function instructionsOf(instructions: string | undefined): string {
  const text = instructions?.trim() ?? "";
  return text === "" ? "" : `Your own instructions:\n${text}\n\n`;
}

function describeDepartments(departments: DepartmentView[]): string {
  if (departments.length === 0) return "There are no departments yet; propose new ones.";
  return departments
    .map((department) => {
      const state =
        department.busyWith === undefined ? "free" : `busy with "${department.busyWith}"`;
      return `- ${department.name} (${state}), working in ${department.folders.join(", ")}:\n${department.members.map((member) => `  ${member}`).join("\n")}`;
    })
    .join("\n");
}

export function chiefBrief(input: {
  goal: string;
  folder: string;
  instructions: string | undefined;
  departments: DepartmentView[];
  choices: HarnessChoices[];
}): Message {
  const text = `You are the chief in Office Town, an app where teams of AI agents work on goals for the user. Each department is a team with a lead and workers. You do not do the work yourself: you split the goal into pieces, one per department's part of it, and the departments do them.

${instructionsOf(input.instructions)}The goal:
${input.goal}

You work in ${input.folder}. You may read every department's workspace, but never change it.

The departments:
${describeDepartments(input.departments)}

Your first step is to plan. Look around just enough to judge the work, then call the propose_plan tool with the pieces: each for one department, with a brief that stands alone, as the department knows nothing else. Say that a piece waits on another only when it truly needs that one's result; pieces that wait on nothing run at the same time, and a piece for a busy department waits until it is free. A department that is needed but does not exist can be proposed in the plan, with its lead's harness and model from the list below; its lead proposes its team when its piece starts. The user edits and approves the plan, and you get a message when they answer.

Harnesses and models for a new department's lead:
${describeChoices(input.choices)}

Each piece's result reaches you as a message when its department finishes, and passes on to the pieces that wait on it. To steer a lead while its department works, use message_lead. If a piece fails, propose a changed plan with propose_plan, or finish. When every piece is done, end with a short account of the whole goal for the user.

If you cannot go on without the user's decision, ask with the ask_user tool.`;
  return {
    text,
    origin: { kind: "brief", summary: "The goal, the departments, and how to plan" },
  };
}

export function handOff(input: {
  chief: string;
  chiefGoal: string;
  title: string;
  // Set for a department the chief proposed, whose lead still has to propose its team.
  newDepartment: { name: string; purpose: string } | undefined;
  upstream: UpstreamResult[];
  readOnly: string[];
}): string {
  const named =
    input.newDepartment === undefined
      ? ""
      : `\n\nThe chief named your team ${input.newDepartment.name}: ${input.newDepartment.purpose}. Use that name when you propose it.`;
  const results =
    input.upstream.length === 0
      ? ""
      : `\n\nThe results this piece builds on:\n${input.upstream.map((each) => `From ${each.department} ("${each.title}"):\n${each.result}`).join("\n\n")}`;
  const folders =
    input.readOnly.length === 0
      ? ""
      : `\n\nYou may read these folders of the teams before you, but never change them: ${input.readOnly.join(", ")}.`;
  return `This goal is the piece "${input.title}" of a bigger goal that the chief, ${input.chief}, runs for the user:
${input.chiefGoal}${named}${results}${folders}

When the goal is done, your last message goes to the chief as your result, so end with a short account of what your team did and where it is.`;
}

export type PieceEnding = "done" | "failed" | "stopped";

const REPLAN =
  "Pieces that wait on it are held. Propose a changed plan with propose_plan, or finish.";

// The department's result, or why it did not finish.
export function pieceResult(
  department: string,
  title: string,
  ending: PieceEnding,
  result: string,
): string {
  if (ending === "done") return `${department} finished "${title}":\n${result}`;
  if (ending === "stopped") {
    return `${department} was stopped before it finished "${title}".\n\n${REPLAN}`;
  }
  const words = result === "" ? "" : ` Its last words:\n${result}`;
  return `${department} could not finish "${title}".${words}\n\n${REPLAN}`;
}
