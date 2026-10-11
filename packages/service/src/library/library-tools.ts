import { randomUUID } from "node:crypto";
import { readFileSync, type Stats, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  type Attachment,
  type LibraryAudience,
  type LibraryItem,
  MAX_ATTACHMENT_BYTES,
} from "@office-town/contract";
import { environmentPath, hostPath } from "@office-town/harness";
import { z } from "zod";
import { fileKindOf } from "../attachments/attachments.ts";
import { AnswerError } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import type { TeamContext } from "../team/members.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";

const givenToSchema = z
  .enum(["everyone", "my department", "only me"])
  .describe("Who gets it as reference. Your department if you are in one, else everyone.");

type GivenTo = z.infer<typeof givenToSchema>;

const hasWorkspace =
  ({ store }: TeamContext) =>
  (caller: Caller) =>
    store.getTask(caller.taskId)?.workspaceId !== undefined;

function workspaceOf({ store }: TeamContext, caller: Caller): string {
  const workspaceId = store.getTask(caller.taskId)?.workspaceId;
  if (workspaceId === undefined) throw new ToolError("This task has no workspace, so no Library.");
  return workspaceId;
}

function audienceOf(
  { store }: TeamContext,
  caller: Caller,
  choice: GivenTo | undefined,
): LibraryAudience {
  const departmentId =
    store.getTask(caller.taskId)?.departmentId ?? store.getAgent(caller.agentId)?.departmentId;
  const picked = choice ?? (departmentId === undefined ? "everyone" : "my department");
  const none = { everyone: false, departmentIds: [], agentIds: [] };
  if (picked === "everyone") return { ...none, everyone: true };
  if (picked === "only me") return { ...none, agentIds: [caller.agentId] };
  if (departmentId === undefined) throw new ToolError("You are not in a department.");
  return { ...none, departmentIds: [departmentId] };
}

function audienceText({ store }: TeamContext, audience: LibraryAudience): string {
  if (audience.everyone) return "everyone";
  const names = [
    ...audience.departmentIds.map((id) => store.getDepartment(id)?.name),
    ...audience.agentIds.map((id) => store.getAgent(id)?.name),
  ];
  return names.filter((name) => name !== undefined).join(", ") || "no one";
}

const inside = (folder: string, path: string) => {
  const way = relative(folder, path);
  return way === "" || (!way.startsWith("..") && !isAbsolute(way));
};

// Copied, or linked if a folder. Only from the folders the agent works in, so the Library never
// opens up anything the agent could not already read.
function keepFile({ store }: TeamContext, caller: Caller, given: string): Attachment {
  const options = store.getSession(caller.sessionId)?.options;
  if (options === undefined) throw new RecordNotFoundError("session", caller.sessionId);
  const base = options.workspacePath ?? "";
  // A relative path is from where the agent works; a POSIX one may be WSL's view of a host path.
  const path = given.startsWith("/")
    ? resolve(hostPath(options.environment, given))
    : resolve(base, given);
  const folders = [base, ...(options.additionalPaths ?? [])].filter((folder) => folder !== "");
  if (!folders.some((folder) => inside(folder, path))) {
    throw new ToolError(`${given} is outside the folders you work in.`);
  }
  let stats: Stats;
  try {
    stats = statSync(path);
  } catch {
    throw new ToolError(`${given} does not exist.`);
  }
  if (stats.isDirectory()) return store.linkFolder(path);
  if (stats.size > MAX_ATTACHMENT_BYTES) throw new ToolError(`${given} is larger than 20 MB.`);
  const name = basename(path);
  return store.saveFile({ ...fileKindOf(name), name, content: readFileSync(path) });
}

// By name, or by its path as the agent sees it.
function findItem(context: TeamContext, caller: Caller, wanted: string): LibraryItem {
  const { store } = context;
  const environment = store.getSession(caller.sessionId)?.options.environment;
  const items = store.libraryOfWorkspace(workspaceOf(context, caller));
  const found = items.filter(
    ({ file }) =>
      file.name === wanted ||
      file.path === wanted ||
      (environment !== undefined && environmentPath(environment, file.path) === wanted),
  );
  const [item] = found;
  if (item === undefined) {
    const names = items.map(({ file }) => file.name).join(", ") || "nothing yet";
    throw new ToolError(`"${wanted}" is not in the Library. It has: ${names}.`);
  }
  if (found.length > 1) throw new ToolError(`Several items are named "${wanted}"; give its path.`);
  return item;
}

export function addToLibrary(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "add_to_library",
    description:
      "Add a file or folder from your folders to this workspace's Library, so agents get it as " +
      "reference in their next tasks. Files are copied, folders linked. To replace or remove " +
      "an item already there, use change_library.",
    input: z.object({
      path: z.string().min(1).describe("The file or folder, as you see its path."),
      givenTo: givenToSchema.optional(),
    }),
    offeredTo: hasWorkspace(context),
    call({ path, givenTo }, caller) {
      const workspaceId = workspaceOf(context, caller);
      const audience = audienceOf(context, caller, givenTo);
      const file = keepFile(context, caller, path);
      store.addLibraryItem({
        workspaceId,
        attachmentId: file.id,
        givenTo: audience,
        addedByAgentId: caller.agentId,
      });
      return `Added ${file.name} to the Library, given to ${audienceText(context, audience)}.`;
    },
  });
}

const changeSchema = z.object({
  item: z.string().min(1).describe("The item's name, or its path as you see it."),
  change: z.enum(["replace", "remove", "give"]).describe("What to do with it."),
  path: z.string().min(1).optional().describe("For replace: the new file, as you see its path."),
  givenTo: givenToSchema.optional().describe("For give: who gets it from now on."),
  reason: z.string().min(1).describe("Why, in a sentence, for the user."),
});

interface Change {
  title: string;
  apply(): Promise<unknown>;
}

function changeOf(
  context: TeamContext,
  caller: Caller,
  item: LibraryItem,
  { change, path, givenTo }: z.infer<typeof changeSchema>,
): Change {
  const { store } = context;
  const name = item.file.name;
  if (change === "remove") {
    return {
      title: `Remove "${name}" from the Library`,
      apply: () => store.removeLibraryItem(item.id),
    };
  }
  if (change === "give") {
    if (givenTo === undefined) throw new ToolError("Say who gets it in givenTo.");
    const audience = audienceOf(context, caller, givenTo);
    return {
      title: `Give "${name}" in the Library to ${audienceText(context, audience)}`,
      apply: () => store.changeLibraryItem(item.id, { givenTo: audience }),
    };
  }
  if (path === undefined) throw new ToolError("Give the new file's path.");
  // Copied now, so the user approves the very file that goes in.
  const file = keepFile(context, caller, path);
  return {
    title: `Replace "${name}" in the Library with ${file.name}`,
    apply: () => store.changeLibraryItem(item.id, { attachmentId: file.id }),
  };
}

// Replacing, removing or giving an item to others waits for the user in Needs you (D-64).
export function changeLibrary(context: TeamContext) {
  const { registry } = context;
  return defineTool({
    name: "change_library",
    description:
      "Ask the user to replace, remove, or change who gets an item in this workspace's Library. " +
      "It returns at once; the user's answer reaches you later as a message.",
    input: changeSchema,
    offeredTo: hasWorkspace(context),
    call(input, caller) {
      const item = findItem(context, caller, input.item);
      const { title, apply } = changeOf(context, caller, item, input);
      const requestId = `library-${randomUUID()}`;
      const tell = (text: string, summary: string) =>
        registry.tell(caller.sessionId, { text, origin: { kind: "notice", summary } });
      registry.ask(
        caller.sessionId,
        {
          type: "permission.requested",
          payload: {
            requestId,
            title: `${title}. ${input.reason}`,
            input: { path: item.file.path },
            kind: input.change === "remove" ? "delete" : "edit",
            locations: [item.file.path],
            options: [
              { optionId: "approve", label: "Approve", kind: "allow_once" },
              { optionId: "decline", label: "Decline", kind: "reject_once" },
            ],
          },
        },
        (command) => {
          if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
          const approved = command.optionId === "approve";
          return {
            resolution: {
              type: "permission.resolved",
              payload: {
                requestId,
                outcome: approved ? "allowed" : "denied",
                optionId: command.optionId,
                answeredBy: "user",
              },
            },
            afterwards: async () => {
              if (!approved) {
                await tell(`The user declined: ${title}.`, "You declined a Library change");
                return;
              }
              await apply();
              await tell(
                `The user approved, and it is done: ${title}.`,
                "You approved a Library change",
              );
            },
          };
        },
      );
      return "Your change is with the user. Their answer will reach you as a message.";
    },
  });
}
