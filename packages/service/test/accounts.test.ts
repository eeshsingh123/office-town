import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account, AccountLimits } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { chooseAccount, hasSignIn, rememberSignIn } from "../src/accounts/accounts.ts";
import { estimatedUsage } from "../src/accounts/usage.ts";
import { PriceList } from "../src/prices/prices.ts";
import type { Store } from "../src/store/store.ts";

const hourFromNow = new Date(Date.now() + 3600_000).toISOString();
const hourAgo = new Date(Date.now() - 3600_000).toISOString();

const account = (id: string): Account => ({
  id,
  harness: "claude",
  environment: { kind: "native" },
  name: id,
  folder: `/data/accounts/${id}`,
  createdAt: new Date().toISOString(),
});

const used = (accountId: string, usedFraction: number, resetsAt = hourFromNow): AccountLimits => ({
  accountId,
  harness: "claude",
  limits: [{ id: "five_hour", label: "five hour", usedFraction, resetsAt }],
  reportedAt: new Date().toISOString(),
});

const storeWith = (accounts: Account[], limits: AccountLimits[]) =>
  ({ listAccounts: () => accounts, listLimits: () => limits }) as unknown as Store;

const settings = { harness: "claude", environment: { kind: "native" as const } };

describe("account choice", () => {
  it("picks the signed-in account with the most room, counts a reset window as empty, and keeps the user's pick", () => {
    const store = storeWith(
      [account("work"), account("side")],
      [used("claude", 0.8), used("work", 0.3), used("side", 1, hourAgo)],
    );
    const signedIn = () => true;
    expect(chooseAccount(store, settings, signedIn)).toEqual({
      accountId: "side",
      accountFolder: "/data/accounts/side",
    });
    expect(chooseAccount(store, { ...settings, accountId: "work" }, signedIn).accountId).toBe(
      "work",
    );
    // With nothing reported, the default login goes first.
    expect(chooseAccount(storeWith([account("work")], []), settings, signedIn)).toEqual({
      accountId: "claude",
    });
    // One that has not finished signing in is never picked for the user.
    expect(chooseAccount(store, settings).accountId).toBe("claude");
  });
});

describe("signed-in accounts", () => {
  it("counts an added account on a CLI without a sign-in file once the app saw it sign in", () => {
    let settings: { signedInAccounts?: string[] } = {};
    const store = {
      readSettings: () => settings,
      saveSettings: (next: typeof settings) => {
        settings = { ...settings, ...next };
      },
    } as unknown as Store;
    const work = { ...account("work"), harness: "codex" };
    expect(hasSignIn(work, store)).toBe(false);
    rememberSignIn(store, "work", true);
    expect(hasSignIn(work, store)).toBe(true);
    rememberSignIn(store, "work", false);
    expect(hasSignIn(work, store)).toBe(false);
  });
});

describe("usage estimate", () => {
  it("prices each model at its API price, cached input apart, and gives none where a model is unpriced", async () => {
    const prices = new PriceList();
    const list = {
      openai: { models: { "gpt-6.1-sol": { cost: { input: 2, output: 10, cache_read: 0.1 } } } },
    };
    const fetchList = async () => Response.json(list);
    await prices.load(mkdtempSync(join(tmpdir(), "prices-")), fetchList as typeof fetch);
    const row = (agentId: string, model?: string) => ({
      accountId: "codex",
      agentId,
      tasks: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cachedInputTokens: 500_000,
      ...(model === undefined ? {} : { model }),
    });
    const rows = estimatedUsage(
      [row("a", "gpt-6.1-sol"), row("a", "gpt-6.1-sol"), row("b", "gpt-6.1-sol"), row("b")],
      (one) => prices.estimate(one.model, ["openai"], one),
    );
    // 0.5M input at $2, 0.5M cached at $0.10, 0.1M output at $10, twice.
    expect(rows.find((one) => one.agentId === "a")).toMatchObject({
      inputTokens: 2_000_000,
      estimatedUsd: 4.1,
    });
    expect(rows.find((one) => one.agentId === "b")?.estimatedUsd).toBeUndefined();
  });
});
