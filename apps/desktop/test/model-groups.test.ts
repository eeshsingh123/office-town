import type { HarnessModel } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { groupModels } from "../src/features/new-task/model-groups.ts";

const model = (id: string, provider?: string, free?: boolean): HarnessModel => ({
  id,
  name: id,
  efforts: [],
  ...(provider === undefined ? {} : { provider }),
  ...(free === undefined ? {} : { free }),
});

const headings = ({ first, more }: ReturnType<typeof groupModels>) => ({
  first: first.map((group) => [group.heading, group.models.map((m) => m.id)]),
  more: more.map((group) => [group.heading, group.models.map((m) => m.id)]),
});

describe("model groups", () => {
  it("puts recent, free and used providers first, lists each model once, and tucks the rest away", () => {
    const models = [
      model("go/glm", "go"),
      model("go/bunny-free", "go", true),
      model("zen/pickle", "zen", true),
      model("go/kimi", "go"),
      model("openai/gpt", "openai"),
    ];

    expect(headings(groupModels(models, ["go/kimi", "gone/model"]))).toEqual({
      first: [
        ["Recent", ["go/kimi"]],
        ["Free", ["go/bunny-free", "zen/pickle"]],
        ["go", ["go/glm"]],
      ],
      more: [["openai", ["openai/gpt"]]],
    });
  });

  it("shows every model of a harness with one provider", () => {
    expect(headings(groupModels([model("haiku"), model("sonnet")], []))).toEqual({
      first: [["Models", ["haiku", "sonnet"]]],
      more: [],
    });
  });
});
