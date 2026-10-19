import { describe, expect, it } from "vitest";
import { baseRole } from "../src/features/departments/team-form.ts";
import { pointsOf, textOf } from "../src/ui/points.ts";

describe("points", () => {
  it("reads one point per line, dropping list markers and blank lines", () => {
    expect(pointsOf("- Use TypeScript\n\n2. Write tests")).toEqual([
      "Use TypeScript",
      "Write tests",
    ]);
  });

  it("cuts a paragraph into its sentences", () => {
    const paragraph = `${"Main stays stable and changes only through merges done by the lead. ".repeat(3)}Never force-push.`;
    expect(pointsOf(paragraph)).toHaveLength(4);
  });

  it("writes points back one per line, without empty ones", () => {
    expect(textOf(["Use TypeScript ", "", "Write tests"])).toBe("Use TypeScript\nWrite tests");
  });
});

describe("baseRole", () => {
  it("puts numbered people in one role", () => {
    expect(baseRole("Full-Stack Developer 2")).toBe("Full-Stack Developer");
    expect(baseRole("Research & UX Lead")).toBe("Research & UX Lead");
  });
});
