import {
  type AgentRecord,
  type DepartmentRecord,
  type LibraryAudience,
  type LibraryItem,
  MAX_ATTACHMENT_BYTES,
} from "@office-town/contract";
import { useMemo } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

export const EVERYONE: LibraryAudience = { everyone: true, departmentIds: [], agentIds: [] };

// A department, or one agent in it, that items can be given to.
export type Holder = { departmentId: string; agentId?: string };

export function useLibrary(workspaceId: string | undefined): LibraryItem[] {
  const library = useApp((state) => state.library);
  return useMemo(
    () =>
      Object.values(library)
        .filter((item) => item.workspaceId === workspaceId)
        .toSorted((a, b) => a.file.name.localeCompare(b.file.name)),
    [library, workspaceId],
  );
}

// The core's rule: given to everyone, to the holder's department, or to the agent itself.
export function reaches({ givenTo }: LibraryItem, holder: Holder): boolean {
  return (
    givenTo.everyone ||
    givenTo.departmentIds.includes(holder.departmentId) ||
    (holder.agentId !== undefined && givenTo.agentIds.includes(holder.agentId))
  );
}

// Given straight to the holder, so it can be taken back from there.
export function givenDirectly({ givenTo }: LibraryItem, holder: Holder): boolean {
  return holder.agentId === undefined
    ? givenTo.departmentIds.includes(holder.departmentId)
    : givenTo.agentIds.includes(holder.agentId);
}

export function withHolder(audience: LibraryAudience, holder: Holder, on: boolean) {
  const key = holder.agentId === undefined ? "departmentIds" : "agentIds";
  const id = holder.agentId ?? holder.departmentId;
  const list = audience[key].filter((each) => each !== id);
  return { ...audience, everyone: false, [key]: on ? [...list, id] : list };
}

export const givenToSomeone = ({ everyone, departmentIds, agentIds }: LibraryAudience) =>
  everyone || departmentIds.length + agentIds.length > 0;

export function audienceNames(
  { everyone, departmentIds, agentIds }: LibraryAudience,
  departments: Record<string, DepartmentRecord>,
  agents: Record<string, AgentRecord>,
): string {
  if (everyone) return "Everyone";
  const names = [
    ...departmentIds.flatMap((id) => departments[id]?.name ?? []),
    ...agentIds.flatMap((id) => agents[id]?.name ?? []),
  ];
  return names.length === 0 ? "No one" : names.join(", ");
}

export const usedText = ({ givenIn, openedIn }: LibraryItem) =>
  givenIn === 0
    ? "Not used yet"
    : `Opened in ${openedIn} of ${givenIn} ${givenIn === 1 ? "task" : "tasks"}`;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// Each file is copied into the app's data folder first, then added; the failures are returned.
export async function addFiles(
  workspaceId: string,
  files: readonly File[],
  givenTo: LibraryAudience,
): Promise<string[]> {
  const results = await Promise.allSettled(
    files.map(async (file) => {
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("it is larger than 20 MB");
      const attachment = await api.uploadFile(file, file.name);
      await api.addLibraryItem(workspaceId, { attachmentId: attachment.id, givenTo });
    }),
  );
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`Could not add ${files[index]?.name}: ${errorText(result.reason)}`]
      : [],
  );
}

export async function addFolder(workspaceId: string, path: string, givenTo: LibraryAudience) {
  const attachment = await api.linkFolder(path);
  await api.addLibraryItem(workspaceId, { attachmentId: attachment.id, givenTo });
}

export async function replaceFile(itemId: string, file: File): Promise<void> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
  const attachment = await api.uploadFile(file, file.name);
  await api.changeLibraryItem(itemId, { attachmentId: attachment.id });
}
