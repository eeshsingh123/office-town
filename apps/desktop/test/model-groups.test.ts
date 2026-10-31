import type { HarnessModel } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { groupModels } from "../src/features/new-task/model-groups.ts";

const model = (id: string): HarnessModel => ({ id, name: id, efforts: [], access: "free" });

describe("groupModels", () => {
  it("leaves the pinned model out of every group, even Recent", () => {
    const models = [model("a"), model("b"), model("c")];
    const { first, more } = groupModels(models, ["b", "c"], "b");
    const listed = [...first, ...more].flatMap((group) => group.models.map(({ id }) => id));
    expect(listed.sort()).toEqual(["a", "c"]);
  });
});
