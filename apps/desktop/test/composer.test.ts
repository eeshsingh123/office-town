import { describe, expect, it } from "vitest";
import { mentionAt, withoutMention } from "../src/features/new-task/targets.ts";

describe("composer mentions", () => {
  it("opens on @ after a space and / only at the start, never inside a path", () => {
    expect(mentionAt("@Res", 4)).toEqual({ kind: "@", query: "res", start: 0 });
    expect(mentionAt("fix it @we", 10)).toEqual({ kind: "@", query: "we", start: 7 });
    expect(mentionAt("/web", 4)).toEqual({ kind: "/", query: "web", start: 0 });
    expect(mentionAt("fix src/app", 11)).toBeUndefined();
    expect(mentionAt("this and /that", 14)).toBeUndefined();
    expect(mentionAt("mail me@home", 12)).toBeUndefined();
    expect(withoutMention("@res compare apps", { kind: "@", query: "res", start: 0 }, 4)).toBe(
      "compare apps",
    );
  });
});
