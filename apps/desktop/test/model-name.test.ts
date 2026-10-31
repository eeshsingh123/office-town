import type { HarnessModel } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { effortsOf } from "../src/features/profiles/model-name.ts";

const model = (id: string, efforts: string[]): HarnessModel => ({ id, name: id, efforts });

describe("effortsOf", () => {
  it("names the picked model's efforts, and the listed default's when nothing is picked", () => {
    const models = [model("default", ["low", "max"]), model("opus", ["high"])];
    expect(effortsOf(models, "opus")).toEqual(["high"]);
    expect(effortsOf(models, undefined)).toEqual(["low", "max"]);
  });

  it("offers what most models share when the AI app lists no default", () => {
    const models = [
      model("a", ["low", "medium", "high"]),
      model("b", ["none", "low", "high"]),
      model("c", ["low", "high", "max"]),
      model("d", []),
    ];
    expect(effortsOf(models, undefined)).toEqual(["low", "high"]);
    expect(effortsOf(models, "d")).toEqual([]);
  });
});
