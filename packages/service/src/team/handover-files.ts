import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HandoverFile } from "@office-town/contract";
import type { Store } from "../store/store.ts";

// One Markdown file per session that handed over, named by it, in the data folder (D-94).
export const handoverFolder = (dataFolder: string, taskId: string) =>
  join(dataFolder, "handovers", taskId);

// Only a session of the task names a file, so no path given from outside reaches anything else.
export function handoverFile(
  store: Store,
  dataFolder: string,
  taskId: string,
  sessionId: string,
): string | undefined {
  if (store.getSession(sessionId)?.taskId !== taskId) return undefined;
  return join(handoverFolder(dataFolder, taskId), `${sessionId}.md`);
}

export async function listHandovers(
  store: Store,
  dataFolder: string,
  taskId: string,
): Promise<HandoverFile[]> {
  const folder = handoverFolder(dataFolder, taskId);
  const names = await readdir(folder).catch(() => []);
  const files = await Promise.all(
    names.map(async (name): Promise<HandoverFile | undefined> => {
      const sessionId = name.replace(/\.md$/, "");
      const session = store.getSession(sessionId);
      if (!name.endsWith(".md") || session?.taskId !== taskId) return undefined;
      const written = await stat(join(folder, name)).catch(() => undefined);
      if (written === undefined) return undefined;
      return { sessionId, agentId: session.agentId, at: written.mtime.toISOString() };
    }),
  );
  return files.filter((file) => file !== undefined).sort((a, b) => a.at.localeCompare(b.at));
}

export function removeHandovers(dataFolder: string, taskId: string): Promise<void> {
  return rm(handoverFolder(dataFolder, taskId), { recursive: true, force: true });
}
