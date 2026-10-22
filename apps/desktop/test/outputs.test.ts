import { describe, expect, it } from "vitest";
import { parseTable, shownPath, viewKindOf } from "../src/features/outputs/kinds.ts";

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
});
