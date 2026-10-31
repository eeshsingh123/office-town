import type { HarnessDescription } from "@office-town/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offeredHarnesses } from "../src/features/providers/offered.ts";

vi.mock("../src/api/client.ts", () => ({
  api: { readCatalog: vi.fn(async () => ({ models: [{ id: "m", name: "M", efforts: [] }] })) },
}));

const NATIVE = { kind: "native" } as const;

describe("offeredHarnesses", () => {
  const apps = ["claude", "opencode", "cursor"].map((harness) => ({ harness }));
  const offered = (ready: readonly string[] | undefined, current: string) =>
    offeredHarnesses(apps as HarnessDescription[], ready, current).map(({ harness }) => harness);

  it("offers only the chosen app until the ready ones are known", () => {
    expect(offered(undefined, "cursor")).toEqual(["cursor"]);
    expect(offered(["claude"], "opencode")).toEqual(["claude", "opencode"]);
  });
});

describe("lastCatalog", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    stored.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });

  it("keeps a read for the next launch and ignores a saved list it cannot trust", async () => {
    const first = await import("../src/api/catalogs.ts");
    await first.readCatalog("claude", NATIVE);
    await vi.waitFor(() => expect(first.lastCatalog("claude", NATIVE)).toBeDefined());

    vi.resetModules();
    const next = await import("../src/api/catalogs.ts");
    expect(next.lastCatalog("claude", NATIVE)?.models[0]?.id).toBe("m");

    stored.set("office-town.catalogs", JSON.stringify({ "claude|native": { models: "old" } }));
    vi.resetModules();
    const broken = await import("../src/api/catalogs.ts");
    expect(broken.lastCatalog("claude", NATIVE)).toBeUndefined();
  });
});
