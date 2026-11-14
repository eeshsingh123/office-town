import type { Account, AccountUsage } from "@office-town/contract";
import { LogIn, Pencil, Trash2 } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, useAgents } from "../../store/agents.ts";
import type { MenuContent } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { sessionAccountId } from "./limits.ts";
import { reloadAccounts } from "./use-usage.ts";

const DAY_MS = 24 * 3600_000;
const startOfToday = () => new Date(new Date().toDateString()).toISOString();
const weekAgo = () => new Date(Date.now() - 7 * DAY_MS).toISOString();

export interface Spend {
  today: AccountUsage[];
  week: AccountUsage[];
}

export const tokensOf = (rows: readonly AccountUsage[]) =>
  rows.reduce((sum, row) => sum + row.inputTokens - row.cachedInputTokens + row.outputTokens, 0);

// At API prices (D-76): "at least" where some tokens ran on a model with no listed price, and none
// where no model had one.
export interface Estimate {
  dollars: number;
  atLeast: boolean;
}

export function estimateOf(rows: readonly AccountUsage[]): Estimate | undefined {
  const used = rows.filter((row) => tokensOf([row]) > 0);
  const priced = used.filter((row) => row.estimatedUsd !== undefined);
  if (priced.length === 0) return undefined;
  return {
    dollars: priced.reduce((sum, row) => sum + (row.estimatedUsd ?? 0), 0),
    atLeast: priced.length < used.length,
  };
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function estimateText({ dollars, atLeast }: Estimate): string {
  if (dollars < 0.01) return atLeast ? "No API price for its models" : "Under $0.01 at API prices";
  return `${atLeast ? "At least" : "About"} ${USD.format(dollars)} at API prices`;
}

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

// An added account's "…" menu (Rename, Sign in again, Remove) and the dialog it opens. The CLI's
// own login has none: it is signed in and out in the CLI.
export function useAccountMenu(): {
  menu: (account: Account) => MenuContent | undefined;
  dialogs: ReactNode;
} {
  const [open, setOpen] = useState<Open>();
  const close = () => setOpen(undefined);
  const menu = (account: Account): MenuContent | undefined =>
    account.folder === undefined
      ? undefined
      : {
          actions: [
            { label: "Rename", icon: Pencil, run: () => setOpen({ kind: "rename", account }) },
            { label: "Sign in again", icon: LogIn, run: () => setOpen({ kind: "again", account }) },
            {
              label: "Remove",
              icon: Trash2,
              danger: true,
              run: () => setOpen({ kind: "remove", account }),
            },
          ],
        };
  const dialogs =
    open?.kind === "again" ? (
      <AddAccountDialog again={open.account} onClose={close} />
    ) : open?.kind === "rename" ? (
      <RenameDialog account={open.account} onClose={close} />
    ) : open?.kind === "remove" ? (
      <RemoveDialog account={open.account} onClose={close} />
    ) : null;
  return { menu, dialogs };
}
