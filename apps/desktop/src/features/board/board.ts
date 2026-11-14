import type { Item, RowStatus } from "../tasks/task-list.ts";

export type ColumnId = "needs-you" | "working" | "queued" | "review" | "ended" | "done";

export type Columns = Record<ColumnId, Item[]>;

// The Board shows the newest finished work; Tasks keeps the rest.
export const DONE_SHOWN = 20;

// Stopped and failed work waits on the user to continue it, in a column of its own (owner).
const COLUMN_OF: Record<RowStatus, ColumnId> = {
  needs: "needs-you",
  working: "working",
  queued: "queued",
  stopped: "ended",
  failed: "ended",
  review: "review",
  done: "done",
};

// The same statuses as Tasks. A goal that needs the user only through a part is at work, so the
// ask shows once, on the part; parts not started yet wait.
export function boardColumns(items: readonly Item[]): Columns {
  const columns: Columns = {
    "needs-you": [],
    working: [],
    queued: [],
    review: [],
    ended: [],
    done: [],
  };
  const cards = items.flatMap((item) => [
    item,
    ...item.parts.filter((part) => part.task === undefined),
  ]);
  for (const item of cards) {
    const throughPart = item.status === "needs" && item.answerTaskId !== item.id;
    columns[throughPart ? "working" : COLUMN_OF[item.status]].push(item);
  }
  for (const column of Object.values(columns)) {
    column.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  }
  return columns;
}
