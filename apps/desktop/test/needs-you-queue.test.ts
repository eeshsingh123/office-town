import type {
  AgentRecord,
  SessionRecord,
  TaskRecord,
  UserRequestEvent,
} from "@office-town/contract";
import { describe, expect, it } from "vitest";
import {
  buildAsks,
  filterAsks,
  groupAsks,
  NO_FILTERS,
  ofType,
  typeCounts,
} from "../src/features/needs-you/queue.ts";
import type { WaitingRequest } from "../src/store/records.ts";

const session = (id: string, taskId: string, harness: string) =>
  ({ id, agentId: `agent-${id}`, taskId, options: { harness } }) as unknown as SessionRecord;

const task = (id: string, prompt: string) => ({
  task: { id, prompt, workspaceId: "w1" } as TaskRecord,
  sessionIds: [],
});

const asked = (
  sessionId: string,
  position: number,
  minute: number,
  type: UserRequestEvent["type"],
  payload: object,
): WaitingRequest => ({
  position,
  event: {
    sessionId,
    type,
    timestamp: new Date(Date.UTC(2026, 9, 11, 9, minute)).toISOString(),
    payload: { requestId: `r${position}`, ...payload },
  } as UserRequestEvent,
});

const approval = (sessionId: string, position: number, minute: number, command: string) =>
  asked(sessionId, position, minute, "permission.requested", {
    title: "Run a command",
    input: { command },
    options: [],
  });

const sources = {
  waiting: {
    a: approval("s1", 1, 0, "git log"),
    b: approval("s2", 2, 5, "pnpm test"),
    c: asked("s2", 3, 10, "question.requested", {
      questions: [{ questionId: "q", text: "Retry or fix?", options: [], multiSelect: false }],
    }),
    d: asked("s1", 4, 20, "plan.requested", {
      pieces: [{ title: "Draft" }, { title: "Review" }],
      replan: false,
    }),
  },
  sessions: { s1: session("s1", "t1", "claude"), s2: session("s2", "t2", "opencode") },
  tasks: { t1: task("t1", "Launch notes"), t2: task("t2", "Fix the login test") },
  agents: {
    "agent-s1": { id: "agent-s1", name: "@ines", colour: "#6553AE" } as AgentRecord,
    "agent-s2": { id: "agent-s2", name: "@sam", colour: "#3A6EA5" } as AgentRecord,
  },
  departments: {},
  workspaces: [{ id: "w1", name: "office-town" }] as never,
  harnessName: (harness: string) => (harness === "claude" ? "Claude Code" : "OpenCode"),
};

describe("the Needs you queue", () => {
  it("puts plans first, then questions, then approvals, each oldest first, and orders groups by their most urgent ask", () => {
    const asks = buildAsks(sources);
    expect(asks.map((ask) => ask.kind)).toEqual(["plan", "question", "approval", "approval"]);
    expect(asks[0]).toMatchObject({ title: "Plan with 2 pieces", detail: "Draft, Review" });
    expect(asks[2]).toMatchObject({ detail: "git log", workspaceName: "office-town" });

    const groups = groupAsks(asks, "task");
    expect(groups.map((group) => [group.name, group.asks.length, group.approvals.length])).toEqual([
      ["Launch notes", 2, 1],
      ["Fix the login test", 2, 1],
    ]);
    expect(groups[0]?.meta).toBe("No department · office-town · Claude Code");
    expect(groupAsks(asks, "workspace")[0]?.meta).toBe("No department · 2 AI apps");
  });

  it("filters by everything but the type, so the type chips count what the other filters leave", () => {
    const asks = buildAsks(sources);
    const opencode = filterAsks(asks, { ...NO_FILTERS, harness: "OpenCode" });
    expect(typeCounts(opencode)).toEqual({ all: 2, decisions: 0, question: 1, approval: 1 });
    expect(ofType(opencode, "approval").map((ask) => ask.detail)).toEqual(["pnpm test"]);

    const older = filterAsks(asks, { ...NO_FILTERS, askedBefore: Date.UTC(2026, 9, 11, 9, 6) });
    expect(older.map((ask) => ask.detail)).toEqual(["git log", "pnpm test"]);
    expect(filterAsks(asks, { ...NO_FILTERS, query: "LOGIN" })).toHaveLength(2);
  });
});
