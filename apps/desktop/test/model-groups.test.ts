import type { HarnessModel } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { groupModels } from "../src/features/new-task/model-groups.ts";
import { modelName } from "../src/features/profiles/model-name.ts";

const model = (id: string, provider?: string, access?: HarnessModel["access"]): HarnessModel => ({
  id,
  name: id,
  efforts: [],
  ...(provider === undefined ? {} : { provider }),
  ...(access === undefined ? {} : { access }),
});

const headings = ({ first, more }: ReturnType<typeof groupModels>) => ({
  first: first.map((group) => [group.heading, group.models.map((m) => m.id)]),
  more: more.map((group) => [group.heading, group.models.map((m) => m.id)]),
});

describe("model groups", () => {
  it("puts recent, free, plan and used providers first, lists each model once, and tucks the rest away", () => {
    const models = [
      model("go/glm", "go", "plan"),
      model("go/bunny-free", "go", "free"),
      model("zen/pickle", "zen", "free"),
      model("go/kimi", "go", "plan"),
      model("openai/gpt", "openai", "paid"),
      model("openai/mini", "openai", "paid"),
      model("zen/opus", "zen", "paid"),
    ];

    expect(headings(groupModels(models, ["openai/mini", "gone/model"]))).toEqual({
      first: [
        ["Recent", ["openai/mini"]],
        ["Free", ["go/bunny-free", "zen/pickle"]],
        ["In your plan", ["go/glm", "go/kimi"]],
        ["openai", ["openai/gpt"]],
      ],
      more: [["zen", ["zen/opus"]]],
    });
  });

  it("shows every model of a harness with one provider", () => {
    expect(headings(groupModels([model("haiku"), model("sonnet")], []))).toEqual({
      first: [["Models", ["haiku", "sonnet"]]],
      more: [],
    });
  });

  it("gives a model one name for its alias and its full id, and lists the default once", () => {
    const models = [
      {
        ...model("default"),
        name: "Default (recommended)",
        description: "Opus 5.5 · Best for everyday, complex tasks",
        resolvedId: "claude-opus-5-5",
      },
      { ...model("haiku"), name: "Haiku 5.5", resolvedId: "claude-haiku-5-5" },
    ];
    expect(modelName(models, undefined)).toBe("Opus 5.5");
    expect(modelName(models, "claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName(models, "haiku")).toBe("Haiku 5.5");
    expect(modelName(models, "claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelName(undefined, "claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(headings(groupModels(models, [])).first).toEqual([["Models", ["haiku"]]]);
  });
});
