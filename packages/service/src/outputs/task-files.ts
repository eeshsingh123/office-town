import type { ChangedFile, SessionEvent, SessionRecord, SpottedSite } from "@office-town/contract";
import { canonicalPath } from "../autonomy/policy.ts";
import type { Store } from "../store/store.ts";
import { hostPathOf } from "./paths.ts";
import { localAddresses } from "./sites.ts";

const PAGE = 1_000;
const WRITES = new Set(["edit", "delete", "move"]);

interface Pending {
  deleted: boolean;
  paths: string[];
  // The command a shell action ran, to name how a site was started.
  command?: string;
}

interface SessionScan {
  after: number;
  pending: Map<string, Pending>;
}

interface TaskScan {
  // By canonical path; the latest change wins.
  changed: Map<string, ChangedFile>;
  seen: Map<string, SpottedSite>;
  // The command whose output named each address.
  commands: Map<string, string>;
}

export interface TaskFileFacts {
  changed: ChangedFile[];
  seen: SpottedSite[];
  commands: Map<string, string>;
}

const words = (value: unknown) => (typeof value === "string" ? value : undefined);

function commandOf(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  return words((input as Record<string, unknown>).command);
}

// What the task's agents wrote and which local sites they named, read from their stored events.
// Each session is read once; later calls read only what came since.
export class TaskFiles {
  readonly #store: Store;
  readonly #sessions = new Map<string, SessionScan>();
  readonly #tasks = new Map<string, TaskScan>();

  constructor(store: Store) {
    this.#store = store;
  }

  read(taskId: string): TaskFileFacts {
    let task = this.#tasks.get(taskId);
    if (task === undefined) {
      task = { changed: new Map(), seen: new Map(), commands: new Map() };
      this.#tasks.set(taskId, task);
    }
    for (const session of this.#store.listSessions(taskId)) this.#scan(session, task);
    return {
      changed: [...task.changed.values()],
      seen: [...task.seen.values()],
      commands: task.commands,
    };
  }

  #scan(session: SessionRecord, task: TaskScan): void {
    let scan = this.#sessions.get(session.id);
    if (scan === undefined) {
      scan = { after: 0, pending: new Map() };
      this.#sessions.set(session.id, scan);
    }
    for (;;) {
      const page = this.#store.readEvents({
        after: scan.after,
        limit: PAGE,
        sessionId: session.id,
      });
      for (const { event } of page) this.#take(event, session, scan, task);
      scan.after = page.at(-1)?.position ?? scan.after;
      if (page.length < PAGE) return;
    }
  }

  #take(event: SessionEvent, session: SessionRecord, scan: SessionScan, task: TaskScan): void {
    const spot = (text: string, command?: string) => {
      for (const url of localAddresses(text)) {
        if (!task.seen.has(url)) task.seen.set(url, { url, agentId: session.agentId });
        if (command !== undefined) task.commands.set(url, command);
      }
    };
    switch (event.type) {
      case "action.started": {
        const { actionId, kind, locations = [], input } = event.payload;
        const command = kind === "execute" ? commandOf(input) : undefined;
        if (!WRITES.has(kind) && command === undefined) return;
        const paths = WRITES.has(kind)
          ? locations.flatMap((location) => hostPathOf(session, location) ?? [])
          : [];
        scan.pending.set(actionId, {
          deleted: kind === "delete",
          paths,
          ...(command === undefined ? {} : { command }),
        });
        return;
      }
      case "action.updated":
        if (event.payload.output !== undefined) {
          spot(event.payload.output, scan.pending.get(event.payload.actionId)?.command);
        }
        return;
      case "action.ended": {
        const pending = scan.pending.get(event.payload.actionId);
        scan.pending.delete(event.payload.actionId);
        spot(event.payload.result, pending?.command);
        if (pending === undefined || event.payload.outcome !== "completed") return;
        for (const path of pending.paths) {
          task.changed.set(canonicalPath(path), {
            path,
            agentId: session.agentId,
            deleted: pending.deleted,
            at: event.timestamp,
          });
        }
        return;
      }
      case "message":
        if (event.payload.role === "assistant") spot(event.payload.text);
        return;
      default:
        return;
    }
  }
}
