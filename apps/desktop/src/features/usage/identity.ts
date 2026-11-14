import type { Account, AccountStatus } from "@office-town/contract";
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../../api/client.ts";
import { loadLastKnown, saveLastKnown } from "../../api/last-known.ts";

const SAVED = "account-identities";

// Who each account is signed in as, by account id. Reading one starts its CLI for seconds, so the
// last answer shows at once, on every page and after a restart, while it is read again.
const parse = (saved: unknown) =>
  typeof saved === "object" && saved !== null
    ? (saved as Record<string, AccountStatus>)
    : undefined;

export const useIdentities = create<Record<string, AccountStatus>>(
  () => loadLastKnown(SAVED, parse) ?? {},
);

useIdentities.subscribe((identities) => saveLastKnown(SAVED, identities));

// One read in flight per account, whichever page asks; the core keeps each for a minute (D-103).
const reading = new Map<string, Promise<void>>();

export function readIdentity(accountId: string, fresh = false): Promise<void> {
  const known = reading.get(accountId);
  if (known !== undefined && !fresh) return known;
  const next = api
    .readAccountStatus(accountId, fresh)
    .then((status) => {
      if (status !== null) useIdentities.setState({ [accountId]: status });
    })
    .catch(() => {})
    .finally(() => reading.delete(accountId));
  reading.set(accountId, next);
  return next;
}

// Pages that list accounts read who each one is when they open.
export function useReadIdentities(accounts: readonly Account[]): void {
  const ids = accounts.map((account) => account.id).join("|");
  useEffect(() => {
    for (const id of ids.split("|")) if (id !== "") void readIdentity(id);
  }, [ids]);
}

// A CLI's own word for the plan, such as "max" or "plus"; a name like "OpenCode Go" stays as it is.
export const planName = (plan: string) =>
  /^[a-z]+$/.test(plan) ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : plan;

// An added account by the name the user gave it; the CLI's own login by its email, as "Default"
// tells the user nothing about whose login it is.
export function accountLabel(account: Account | undefined, identity?: AccountStatus): string {
  if (account === undefined) return "Default sign-in";
  if (account.folder !== undefined) return account.name;
  return identity?.email ?? "Default sign-in";
}

export function useAccountLabel(account: Account | undefined): string {
  const identity = useIdentities((state) =>
    account === undefined ? undefined : state[account.id],
  );
  return accountLabel(account, identity);
}

// Every account's label at once, for lists and sentences.
export function useAccountLabels(): (account: Account | undefined) => string {
  const identities = useIdentities();
  return (account) =>
    accountLabel(account, account === undefined ? undefined : identities[account.id]);
}
