import type { Account, AccountLimits } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { chooseAccount } from "../src/accounts/accounts.ts";
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
