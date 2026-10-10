import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AgentRecord,
  lowerAutonomy,
  type NewAgent,
  type SecondOpinionRequest,
  type SessionRecord,
  type WorkspaceEntry,
} from "@office-town/contract";
import { z } from "zod";
import { createAgent } from "../agents/agents.ts";
import { instructionsFor } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { levelOf } from "../autonomy/policy.ts";
import type { Message } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isOpen, latestSession, leadsTeam } from "./lead.ts";
import { type TeamContext, TeamError } from "./members.ts";

// What a fresh look must not inherit, and heavy folders nobody reviews.
const LEFT_OUT = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".claude",
  ".opencode",
  ".git",
  "node_modules",
]);
const OUTSOURCED = "outsourced";

function inside(folder: string, path: string): boolean {
  const way = relative(folder, path);
  return way === "" || (!way.startsWith("..") && !isAbsolute(way));
}

// The first is where paths are read from.
function foldersOf(session: SessionRecord): string[] {
  const { workspacePath, additionalPaths = [] } = session.options;
  if (workspacePath === undefined) throw new TeamError("This task has no workspace.");
  return [workspacePath, ...additionalPaths];
}

// A copy, so the reviewer cannot change the original. Every path must stay inside the workspace.
function copyWork(folders: string[], paths: string[], to: string): string[] {
  const [main] = folders;
  if (main === undefined) throw new TeamError("This task has no workspace.");
  mkdirSync(to, { recursive: true });
  return paths.map((path) => {
    const source = resolve(main, path);
    const folder = folders.find((candidate) => inside(candidate, source));
    if (folder === undefined || !existsSync(source)) {
      throw new ToolError(`"${path}" is not in the workspace.`);
    }
    const within = relative(folder, source);
    const target = folder === main ? join(to, within) : join(to, basename(folder), within);
    cpSync(source, target, {
      recursive: true,
      filter: (copied) => !LEFT_OUT.has(basename(copied)),
    });
    return relative(to, target) || ".";
  });
}

function reviewBrief(input: {
  askedBy: string;
  brief: string;
  folder: string;
  paths: string[];
  instructions: string | undefined;
}) {
  const first = input.instructions === undefined ? "" : `${input.instructions}\n\n`;
  const text = `${first}You give a second opinion in Office Town. You have never seen this work before, and that is the point: judge it fresh.

A copy of the files to examine is in ${input.folder}; changing it changes nothing else. You were given: ${input.paths.join(", ")}.

What to look at:
${input.brief}

Your last message is your answer, so end with your findings, the most serious first.`;
  const message: Message = {
    text,
    origin: { kind: "brief", summary: `A second opinion for ${input.askedBy}` },
  };
  return message;
}

interface Asked {
  taskId: string;
  // Whose work is examined, and whose folders the files come from.
  ownerAgentId: string;
  brief: string;
  paths: string[];
  reviewer: NewAgent;
}

// Works in the same task, so it shows beside the team, without joining it (D-18).
async function startReview(context: TeamContext, asked: Asked): Promise<SessionRecord> {
  const { store, registry } = context;
  const session = latestSession(context, asked.taskId, asked.ownerAgentId);
  const owner = store.getAgent(asked.ownerAgentId);
  if (session === undefined || owner === undefined) {
    throw new RecordNotFoundError("agent", asked.ownerAgentId);
  }
  // A reviewer reads and writes only its copy, so Trusted is all it ever needs.
  const autonomy = lowerAutonomy(levelOf(store, owner.id), "trusted");
  // The copy comes first, so a path that cannot be copied leaves no guest behind.
  const folder = join(context.dataFolder, OUTSOURCED, randomUUID());
  let copied: string[];
  let guest: AgentRecord;
  try {
    copied = copyWork(foldersOf(session), asked.paths, folder);
    guest = createAgent(store, asked.reviewer, { role: "Reviewer", autonomy, guest: true });
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  return registry.start({
    taskId: asked.taskId,
    agentId: guest.id,
    options: { ...sessionOptionsFor(store, guest, { workspacePath: folder }), isolated: true },
    message: reviewBrief({
      askedBy: owner.name,
      brief: asked.brief,
      folder,
      paths: copied,
      instructions: instructionsFor(store, guest),
    }),
  });
}

// The agent named, such as a worker in its own worktree, else the task's lead or solo agent.
function ownerOf({ store }: TeamContext, taskId: string, agentId: string | undefined): string {
  const owner =
    agentId ?? store.getTask(taskId)?.leadAgentId ?? store.listSessions(taskId)[0]?.agentId;
  if (owner === undefined) throw new RecordNotFoundError("task", taskId);
  return owner;
}

// The answer is the reviewer's own trace.
export function secondOpinion(
  context: TeamContext,
  taskId: string,
  { brief, paths, reviewer, agentId }: SecondOpinionRequest,
): Promise<SessionRecord> {
  const ownerAgentId = ownerOf(context, taskId, agentId);
  return startReview(context, { taskId, ownerAgentId, brief, paths, reviewer });
}

export function workspaceEntries(
  context: TeamContext,
  taskId: string,
  agentId: string | undefined,
): WorkspaceEntry[] {
  const owner = ownerOf(context, taskId, agentId);
  const main = latestSession(context, taskId, owner)?.options.workspacePath;
  if (main === undefined || !existsSync(main)) return [];
  return readdirSync(main, { withFileTypes: true })
    .filter((entry) => !LEFT_OUT.has(entry.name))
    .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

// Its answer comes back like a worker's result.
export function outsource(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "outsource",
    description:
      "Ask a fresh agent outside your team for a second opinion: it never saw this work and gets " +
      "only your brief and a copy of the files you name, so it cannot change the originals. It " +
      "returns at once; the answer reaches you later as a message.",
    input: z.object({
      brief: z.string().min(1).describe("What to examine, and what to report."),
      paths: z
        .array(z.string().min(1))
        .min(1)
        .describe("Files or folders to copy for it, relative to your workspace."),
      profile: z
        .string()
        .optional()
        .describe("The name of a saved profile to use for the reviewer; yours if left out."),
    }),
    offeredTo: (caller: Caller) => leadsTeam(store, caller),
    async call({ brief, paths, profile }, caller) {
      const lead = store.getAgent(caller.agentId);
      if (lead === undefined) throw new RecordNotFoundError("agent", caller.agentId);
      const saved =
        profile === undefined
          ? undefined
          : store.listProfiles().find((known) => known.name === profile);
      if (profile !== undefined && saved === undefined) {
        const names = store.listProfiles().map((known) => known.name);
        throw new ToolError(
          `No profile "${profile}". Saved profiles: ${names.join(", ") || "none"}.`,
        );
      }
      const { instructions: _, autonomy: __, ...settings } = lead.settings;
      const reviewer: NewAgent = saved === undefined ? { settings } : { profileId: saved.id };
      const session = await startReview(context, {
        taskId: caller.taskId,
        ownerAgentId: caller.agentId,
        brief,
        paths,
        reviewer,
      });
      if (!isOpen(session))
        throw new ToolError("The reviewer could not start. Its trace says why.");
      store.createDelegation({
        taskId: caller.taskId,
        workerAgentId: session.agentId,
        workerSessionId: session.id,
        brief,
      });
      return "A reviewer is on it. Its answer will reach you as a message.";
    },
  });
}

export function removeCopies({ store, dataFolder }: TeamContext, taskId: string): void {
  const copies = join(dataFolder, OUTSOURCED);
  for (const session of store.listSessions(taskId)) {
    const folder = session.options.workspacePath;
    if (store.getAgent(session.agentId)?.guest !== true || folder === undefined) continue;
    if (inside(copies, folder) && folder !== copies)
      rmSync(folder, { recursive: true, force: true });
  }
}

// Checked after every listener ran, so its result has already been handed on.
export function guestsLeave({ store, registry }: TeamContext): void {
  registry.subscribe(({ event }) => {
    if (event.type !== "turn.ended") return;
    const session = store.getSession(event.sessionId);
    if (session === undefined || store.getAgent(session.agentId)?.guest !== true) return;
    queueMicrotask(() => {
      const waiting = store
        .listPendingRequests()
        .requests.some(({ event: request }) => request.sessionId === session.id);
      if (waiting || store.workingDelegation(session.id) !== undefined) return;
      if (!registry.isRunning(session.id)) return;
      registry.stop(session.id, true).catch((error: unknown) => {
        console.error("Could not end a reviewer's session.", error);
      });
    });
  });
}
