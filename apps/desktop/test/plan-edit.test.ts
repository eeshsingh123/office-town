import { describe, expect, it } from "vitest";
import { type PlanRow, planProblem, wouldCycle } from "../src/features/plan/plan-edit.ts";

const row = (key: string, waitsOn: string[], fields: Partial<PlanRow> = {}): PlanRow => ({
  key,
  title: key,
  brief: `Do ${key}`,
  waitsOn,
  department: { departmentId: "web" },
  ...fields,
});

describe("plan edits", () => {
  it("refuses a circle of waits and a new department without a workspace", () => {
    const rows = [row("research", []), row("build", ["research"]), row("test", ["build"])];
    expect(planProblem(rows)).toBeUndefined();
    expect(wouldCycle(rows, "research", "test")).toBe(true);
    expect(wouldCycle(rows, "test", "research")).toBe(false);
    expect(planProblem([row("a", ["b"]), row("b", ["a"])])).toBe(
      "The pieces wait on each other in a circle.",
    );

    const lead = { harness: "opencode", environment: { kind: "native" as const } };
    const content = { name: "Content", purpose: "copy", lead, autonomy: "trusted" as const };
    const placing = [...rows, row("copy", [], { department: { newDepartment: content } })];
    expect(planProblem(placing)).toBe("Choose a workspace for Content to approve.");
    const placed = { newDepartment: { ...content, workspaceId: "w1" } };
    expect(planProblem([...rows, row("copy", [], { department: placed })])).toBeUndefined();
  });

  const lead = { harness: "opencode", environment: { kind: "native" as const } };
  const team = (name: string) => ({
    department: {
      newDepartment: { name, purpose: "", lead, autonomy: "trusted" as const, workspaceId: "w1" },
    },
  });
  it.each([
    ["the same key twice", [row("a", []), row("a", [])], "Two pieces share a key"],
    [
      "one new department in two pieces",
      [row("a", [], team("QA")), row("b", [], team(" QA "))],
      "The new department QA has two pieces",
    ],
    ["a new department named like a saved one", [row("a", [], team("Web"))], "called Web exists"],
  ])("refuses %s, as the core does", (_, rows, problem) => {
    expect(planProblem(rows, [], ["Web"])).toContain(problem);
  });
});
