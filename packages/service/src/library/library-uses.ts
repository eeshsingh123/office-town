import type { SessionEvent } from "@office-town/contract";
import type { PublishedEvent, SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";

const READS = new Set(["read", "search"]);

// Windows ignores case and takes either slash.
function comparable(path: string): string {
  const slashed = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(slashed) || slashed.startsWith("//") ? slashed.toLowerCase() : slashed;
}

const within = (folder: string, path: string) => path === folder || path.startsWith(`${folder}/`);

// Counts, for the Library page, the tasks each item went to and those where an agent opened it,
// from the agents' own read and list calls, never from what they say (D-64).
export function followLibraryUses(registry: SessionRegistry, store: Store): () => void {
  const taskOf = (event: SessionEvent) => store.getSession(event.sessionId)?.taskId;
  return registry.subscribe(({ event }: PublishedEvent) => {
    if (event.type === "message" && event.payload.role === "user") {
      const taskId = taskOf(event);
      if (taskId === undefined) return;
      for (const sent of event.payload.attachments ?? []) {
        const item = store.libraryItemOf(sent.id);
        if (item !== undefined) store.noteLibraryGiven(item.id, taskId);
      }
      return;
    }
    if (event.type !== "action.started" || !READS.has(event.payload.kind)) return;
    const locations = (event.payload.locations ?? []).map(comparable);
    const taskId = locations.length === 0 ? undefined : taskOf(event);
    if (taskId === undefined) return;
    for (const item of store.libraryUnopenedIn(taskId)) {
      const path = comparable(item.path);
      if (!locations.some((location) => within(path, location))) continue;
      store.noteLibraryOpened(item.itemId, taskId, new Date(event.timestamp));
    }
  });
}
