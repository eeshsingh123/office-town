import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Account,
  type AccountLimits,
  type AgentSettings,
  defaultAccountId,
  type EnvironmentSpec,
  type HarnessDescription,
  type SessionOptions,
} from "@office-town/contract";
import { accountCredentials } from "@office-town/harness";
import type { Store } from "../store/store.ts";

// An added account counts once its sign-in is saved in its folder, or, for a CLI that may keep it
// in the system's credential store, once the app saw it sign in; a default login always does.
export function hasSignIn(account: Account, store: Pick<Store, "readSettings">): boolean {
  if (account.folder === undefined) return true;
  const file = accountCredentials(account.harness);
  if (file === undefined) return rememberedSignIns(store).includes(account.id);
  return existsSync(join(account.folder, file));
}

export function rememberedSignIns(store: Pick<Store, "readSettings">): string[] {
  return store.readSettings().signedInAccounts ?? [];
}

// For a CLI that cannot say whether it is signed in, or keeps no file to show it (D-76).
export function rememberSignIn(store: Store, accountId: string, signedIn: boolean): void {
  const others = rememberedSignIns(store).filter((id) => id !== accountId);
  store.saveSettings({ signedInAccounts: signedIn ? [...others, accountId] : others });
}

const sameEnvironment = (a: EnvironmentSpec, b: EnvironmentSpec) =>
  a.kind === b.kind && (a.kind === "native" || (b.kind === "wsl" && a.distro === b.distro));

// The CLI's own login where agents run: one per harness natively, and one per distro in use.
export function defaultAccounts(
  harnesses: readonly HarnessDescription[],
  agentEnvironments: readonly { harness: string; environment: EnvironmentSpec }[],
): Account[] {
  const wanted = [
    ...harnesses.map(({ harness }) => ({ harness, environment: { kind: "native" } as const })),
    ...agentEnvironments.filter(({ environment }) => environment.kind === "wsl"),
  ];
  const seen = new Set<string>();
  return wanted.flatMap(({ harness, environment }) => {
    const id = defaultAccountId(harness, environment);
    if (seen.has(id)) return [];
    seen.add(id);
    const name = environment.kind === "wsl" ? `Default (${environment.distro})` : "Default";
    return [{ id, harness, environment, name, createdAt: new Date(0).toISOString() }];
  });
}

// Every account: the default logins first, then the ones the user added.
export function allAccounts(store: Store, harnesses: readonly HarnessDescription[]): Account[] {
  const used = store.listAgents().map(({ settings }) => settings);
  const added = store
    .listAccounts()
    .map((account) => ({ ...account, signedIn: hasSignIn(account, store) }));
  return [...defaultAccounts(harnesses, used), ...added];
}

// The fullest window that has not reset yet, from 0 to 1; 0 where nothing was reported.
export function fullness(limits: AccountLimits | undefined, now = Date.now()): number {
  const open = (limits?.limits ?? []).filter(
    (limit) => limit.resetsAt === undefined || Date.parse(limit.resetsAt) > now,
  );
  return Math.max(0, ...open.map((limit) => limit.usedFraction));
}

export interface ChosenAccount {
  accountId: string;
  accountFolder?: string;
}

const chosen = (account: Account): ChosenAccount => ({
  accountId: account.id,
  ...(account.folder === undefined ? {} : { accountFolder: account.folder }),
});

// The agent's own pick while it exists; else the signed-in account on its harness with the most
// room, the default login first on a tie (D-61).
export function chooseAccount(
  store: Store,
  settings: AgentSettings,
  signedIn: (account: Account) => boolean = (account) => hasSignIn(account, store),
): ChosenAccount {
  const { harness, environment } = settings;
  const fallback = { id: defaultAccountId(harness, environment), harness, environment };
  const candidates = [
    { ...fallback, name: "Default", createdAt: new Date(0).toISOString() },
    ...store
      .listAccounts()
      .filter(
        (account) =>
          account.harness === harness && sameEnvironment(account.environment, environment),
      ),
  ];
  const picked = candidates.find((account) => account.id === settings.accountId);
  if (picked !== undefined) return chosen(picked);
  const limits = new Map(store.listLimits().map((entry) => [entry.accountId, entry]));
  const roomiest = candidates
    .filter(signedIn)
    .reduce((best, account) =>
      fullness(limits.get(account.id)) < fullness(limits.get(best.id)) ? account : best,
    );
  return chosen(roomiest);
}

// A session from before accounts ran on its harness's default login.
export function sessionAccountId(options: SessionOptions): string {
  return options.accountId ?? defaultAccountId(options.harness, options.environment);
}

// True while one of its windows is used up and has not reset.
export function atLimit(store: Store, accountId: string): boolean {
  return fullness(store.listLimits().find((entry) => entry.accountId === accountId)) >= 1;
}

// A new conversation on another account starts from what the last one said.
export function handover(lastMessage: string | undefined, text: string): string {
  const earlier =
    lastMessage === undefined
      ? ""
      : `\n\nYour last message there was:\n\n${lastMessage.slice(0, 4000)}`;
  return `Your earlier conversation on this task ran out of plan usage, so this is a new conversation on another account. Check the work folder for what is already done before you carry on.${earlier}\n\n${text}`;
}
