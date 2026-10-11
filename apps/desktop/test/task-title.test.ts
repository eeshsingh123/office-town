import { describe, expect, it } from "vitest";
import { taskTitle } from "../src/ui/format.ts";

describe("task title", () => {
  it("keeps the first sentence without the polite opening, cut at a word", () => {
    expect(taskTitle("Hi, can you please write a haiku about the sea. Keep it short")).toBe(
      "Write a haiku about the sea",
    );
    expect(taskTitle(`Summarise ${"the quarterly report ".repeat(5)}`)).toBe(
      "Summarise the quarterly report the quarterly report the…",
    );
  });
});
