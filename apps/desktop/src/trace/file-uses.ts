import type { SentAttachment } from "@office-town/contract";
import type { Trace } from "./trace.ts";

export interface FileUse {
  attachment: SentAttachment;
  // When the agent first read or listed it.
  openedAt?: string;
  // Distinct files it read inside a folder.
  filesOpened: number;
}

const READS = new Set(["read", "search"]);

// Windows ignores case and takes either slash.
function comparable(path: string): string {
  const slashed = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(slashed) || slashed.startsWith("//") ? slashed.toLowerCase() : slashed;
}

interface Watched {
  use: FileUse;
  path: string;
  inside: Set<string>;
}

// From the agent's own read and list calls after the message, never from what it says (D-64).
export function fileUses(trace: Trace): Map<string, FileUse[]> {
  const uses = new Map<string, FileUse[]>();
  const watched: Watched[] = [];
  const visit = (id: string) => {
    const item = trace.items.get(id);
    if (item?.kind === "message" && item.attachments !== undefined) {
      const list = item.attachments.map((attachment) => ({ attachment, filesOpened: 0 }));
      uses.set(id, list);
      for (const use of list) {
        watched.push({ use, path: comparable(use.attachment.path), inside: new Set() });
      }
    }
    if (item?.kind !== "action") return;
    if (READS.has(item.actionKind)) {
      for (const location of item.locations ?? []) {
        const path = comparable(location);
        for (const each of watched) {
          if (path !== each.path && !path.startsWith(`${each.path}/`)) continue;
          each.use.openedAt ??= item.startedAt;
          if (path !== each.path) each.inside.add(path);
          each.use.filesOpened = each.inside.size;
        }
      }
    }
    for (const child of item.children) visit(child);
  };
  for (const id of trace.order) visit(id);
  return uses;
}
