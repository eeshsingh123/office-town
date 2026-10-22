import type { SessionEvent, SessionEventBody } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { parseTable, shownPath, viewKindOf } from "../src/features/outputs/kinds.ts";
import { toBlocks } from "../src/trace/blocks.ts";
import { applyEvents, emptyTrace } from "../src/trace/trace.ts";

function stream(...bodies: SessionEventBody[]): StreamedEvent[] {
  return bodies.map((body, index) => ({
    position: index + 1,
    event: {
      id: `event-${index}`,
      sessionId: "session-1",
      sequence: index + 1,
      timestamp: new Date(Date.UTC(2026, 9, 22, 12, 0, index)).toISOString(),
      ...body,
    } as SessionEvent,
  }));
}

const action = (actionId: string, extra: object): SessionEventBody[] => [
  {
    type: "action.started",
    payload: { actionId, kind: "edit", title: actionId, input: {}, ...extra },
  },
  { type: "action.ended", payload: { actionId, outcome: "completed", result: "ok" } },
];

describe("outputs", () => {
  it("reads quoted cells as spreadsheets write them, shows paths from the task's folder, and picks a view by kind", () => {
    const csv = 'plan,note\r\nPro,"says ""hi"", twice"\nTeam,"two\nlines"\nlast,row';
    expect(parseTable(csv, ",", 3)).toEqual([
      ["plan", "note"],
      ["Pro", 'says "hi", twice'],
      ["Team", "two\nlines"],
    ]);
    expect(shownPath("C:\\work\\bakery\\site\\index.html", ["C:\\work", "C:\\work\\bakery"])).toBe(
      "site/index.html",
    );
    expect(shownPath("/tmp/elsewhere.md", ["C:\\work"])).toBe("/tmp/elsewhere.md");
    expect(viewKindOf({ kind: "file", path: "C:\\work\\Dockerfile" })).toBe("code");
    expect(viewKindOf({ kind: "file", path: "design.FIG" })).toBe("other");
    expect(viewKindOf({ kind: "site", url: "http://localhost:5173/" })).toBe("site");
  });

  it("stands a shown result on its own in the trace, with what was shown, between runs of work", () => {
    const shown = { title: "Pricing page", path: "site/index.html" };
    const trace = applyEvents(
      emptyTrace("session-1"),
      stream(
        ...action("write", {}),
        ...action("show", {
          kind: "other",
          input: shown,
          tool: { server: "office-town", name: "show_result" },
        }),
        ...action("fix", {}),
      ),
    );
    expect(toBlocks(trace).map((block) => (block.kind === "item" ? block.id : block.ids))).toEqual([
      ["write"],
      ["show"],
      ["fix"],
    ]);
    const item = trace.items.get("show");
    expect(item?.kind === "action" ? item.shows : undefined).toEqual(shown);
  });
});
