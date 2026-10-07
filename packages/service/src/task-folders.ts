import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionOptions, StartTaskRequest } from "@office-town/contract";
import type { Store } from "./store/store.ts";

// Characters Windows refuses in a file name, and control characters.
const UNSAFE_IN_NAME = /[<>:"/\\|?*\p{Cc}]/gu;
const NAME_WORDS = 6;
const NAME_LENGTH = 50;

export type TaskFolders = Pick<SessionOptions, "workspacePath" | "additionalPaths">;

export class FolderNotFoundError extends Error {
  constructor(folder: string) {
    super(`The folder "${folder}" does not exist.`);
    this.name = "FolderNotFoundError";
  }
}

export class OutputFolderMissingError extends Error {
  constructor() {
    super("Choose a workspace or an output folder for this task.");
    this.name = "OutputFolderMissingError";
  }
}

export function requireFolders(folders: string[]): void {
  for (const folder of folders) {
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      throw new FolderNotFoundError(folder);
    }
  }
}

// A resumed session runs where it started, so its folders must still be there.
export function requireSessionFolders({
  workspacePath,
  additionalPaths = [],
}: SessionOptions): void {
  requireFolders(
    workspacePath === undefined ? additionalPaths : [workspacePath, ...additionalPaths],
  );
}

// A new folder per task, so tasks never overwrite each other; an output folder given becomes the default.
export function chooseTaskFolders(store: Store, request: StartTaskRequest): TaskFolders {
  if (request.workspaceId !== undefined) {
    const { folders } = store.useWorkspace(request.workspaceId);
    requireFolders(folders);
    const [workspacePath, ...additionalPaths] = folders;
    return additionalPaths.length === 0 ? { workspacePath } : { workspacePath, additionalPaths };
  }
  const outputFolder = request.outputFolder ?? store.readSettings().outputFolder;
  if (outputFolder === undefined) throw new OutputFolderMissingError();
  requireFolders([outputFolder]);
  if (request.outputFolder !== undefined) store.saveSettings({ outputFolder });
  return { workspacePath: createTaskFolder(outputFolder, request.prompt, new Date()) };
}

// Named by the day and the prompt's first words, so the user can tell the folders apart.
function createTaskFolder(parent: string, prompt: string, now: Date): string {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const words = prompt
    .replace(UNSAFE_IN_NAME, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NAME_WORDS)
    .join(" ");
  // By character, so an emoji is never split. Windows drops a trailing dot or space from a name.
  const short = Array.from(words)
    .slice(0, NAME_LENGTH)
    .join("")
    .replace(/[. ]+$/, "");
  const name = short === "" ? day : `${day} ${short}`;
  for (let copy = 1; ; copy += 1) {
    const folder = join(parent, copy === 1 ? name : `${name} (${copy})`);
    try {
      mkdirSync(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
