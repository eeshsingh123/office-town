import type { Account, AccountUsage } from "@office-town/contract";
import { AlertDialog, Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { AccountCard } from "./AccountCard.tsx";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { sessionAccountId } from "./limits.ts";
import styles from "./Usage.module.css";
import { reloadAccounts, useMinute } from "./use-usage.ts";

const DAY_MS = 24 * 3600_000;
const startOfToday = () => new Date(new Date().toDateString()).toISOString();
const weekAgo = () => new Date(Date.now() - 7 * DAY_MS).toISOString();

export interface Spend {
  today: AccountUsage[];
  week: AccountUsage[];
}

export const tokensOf = (rows: readonly AccountUsage[]) =>
  rows.reduce((sum, row) => sum + row.inputTokens - row.cachedInputTokens + row.outputTokens, 0);

// At API prices, only where every row with tokens has a price (D-76).
export const estimateOf = (rows: readonly AccountUsage[]): number | undefined =>
  rows.every((row) => row.estimatedUsd !== undefined || tokensOf([row]) === 0)
    ? rows.reduce((sum, row) => sum + (row.estimatedUsd ?? 0), 0)
    : undefined;

// The turns of today and of the last seven days, read when the page opens.
export function useSpend(): Spend | undefined {
  const [spend, setSpend] = useState<Spend>();
  useEffect(() => {
    let current = true;
    Promise.all([api.listAccountUsage(startOfToday()), api.listAccountUsage(weekAgo())])
      .then(([today, week]) => current && setSpend({ today, week }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return spend;
}

// An agent counts for the account it picked, or else the one its last session ran on.
export function useAccountUsers(): Map<string, Agent[]> {
  const agents = useAgents();
  return useMemo(() => {
    const users = new Map<string, Agent[]>();
    for (const agent of agents) {
      const id = agent.record.settings.accountId ?? sessionAccountId(agent.latest.options);
      users.set(id, [...(users.get(id) ?? []), agent]);
    }
    return users;
  }, [agents]);
}

function RenameDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await api.renameAccount(account.id, name.trim());
      await reloadAccounts();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content}>
          <Dialog.Title className={dialog.title}>Rename account</Dialog.Title>
          <Dialog.Description className="visually-hidden">
            A new name for this account.
          </Dialog.Description>
          <label className={dialog.label}>
            Name
            <input
              className={dialog.input}
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error === undefined ? null : (
            <p className={dialog.error} role="alert">
              {error}
            </p>
          )}
          <div className={dialog.actions}>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" disabled={name.trim() === ""} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const remove = async () => {
    await api.deleteAccount(account.id);
    await reloadAccounts();
    onClose();
  };
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>Remove {account.name}?</AlertDialog.Title>
          <AlertDialog.Description className={dialog.description}>
            Its sign-in is deleted from this computer. Agents that used it switch to Automatic.
          </AlertDialog.Description>
          <div className={dialog.actions}>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant="primary" onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type Open =
  | { kind: "again"; account: Account }
  | { kind: "rename"; account: Account }
  | { kind: "remove"; account: Account };

interface AccountGridProps {
  accounts: readonly Account[];
  spend: Spend | undefined;
  showLeft: boolean;
}

// Each account's plan usage or tokens, who uses it, and its menu (D-61).
export function AccountGrid({ accounts, spend, showLeft }: AccountGridProps) {
  const harnesses = useApp((state) => state.harnesses);
  const limits = useApp((state) => state.limits);
  const traces = useApp((state) => state.traces);
  const usersOf = useAccountUsers();
  const now = useMinute();
  const [open, setOpen] = useState<Open>();
  return (
    <>
      <div className={styles.cards}>
        {accounts.map((account) => {
          const harness = harnesses.find((known) => known.harness === account.harness);
          const users = usersOf.get(account.id) ?? [];
          const working = users.filter((agent) => {
            const state = stateOf(agent, traces, false);
            return state === "working" || state === "starting";
          }).length;
          const mine = (rows: readonly AccountUsage[] | undefined) =>
            (rows ?? []).filter((row) => row.accountId === account.id);
          return (
            <AccountCard
              key={account.id}
              account={account}
              harnessName={harness?.name ?? account.harness}
              usagePage={harness?.usagePage}
              reportsLimits={harness?.capabilities.usageLimits ?? false}
              limits={limits[account.id]}
              users={users}
              working={working}
              tokens={{
                today: tokensOf(mine(spend?.today)),
                week: tokensOf(mine(spend?.week)),
              }}
              estimate={spend === undefined ? undefined : estimateOf(mine(spend.week))}
              showLeft={showLeft}
              now={now}
              onRename={(chosen) => setOpen({ kind: "rename", account: chosen })}
              onSignIn={(chosen) => setOpen({ kind: "again", account: chosen })}
              onRemove={(chosen) => setOpen({ kind: "remove", account: chosen })}
            />
          );
        })}
      </div>
      {open?.kind === "again" ? (
        <AddAccountDialog again={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === "rename" ? (
        <RenameDialog account={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === "remove" ? (
        <RemoveDialog account={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
    </>
  );
}
