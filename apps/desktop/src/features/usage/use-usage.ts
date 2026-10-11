import type { Account, AccountLimits } from "@office-town/contract";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { fullest, roomiest, sameEnvironment, sessionAccountId } from "./limits.ts";

export async function reloadAccounts(): Promise<void> {
  const accounts = await api.listAccounts();
  useApp.setState({ accounts });
}

export interface LimitStop {
  agent: Agent;
  account: Account | undefined;
  accountId: string;
  // When the used-up window resets.
  resetsAt?: number;
  // Where it can carry on now, if another account on its harness has room.
  next?: Account;
}

// An agent whose last turn failed on an account that is used up (D-61).
export function limitStops(
  agents: readonly Agent[],
  isFailed: (agent: Agent) => boolean,
  accounts: readonly Account[],
  limits: Record<string, AccountLimits>,
  now = Date.now(),
): LimitStop[] {
  return agents.flatMap((agent) => {
    const accountId = sessionAccountId(agent.latest.options);
    const full = fullest(limits[accountId], now);
    if (full === undefined || full.usedFraction < 1 || !isFailed(agent)) return [];
    const { harness, environment } = agent.latest.options;
    const others = accounts.filter(
      (account) =>
        account.id !== accountId &&
        account.harness === harness &&
        sameEnvironment(account.environment, environment) &&
        (fullest(limits[account.id], now)?.usedFraction ?? 0) < 1,
    );
    const next = roomiest(others, limits);
    return [
      {
        agent,
        account: accounts.find((account) => account.id === accountId),
        accountId,
        ...(full.resetsAt === undefined ? {} : { resetsAt: Date.parse(full.resetsAt) }),
        ...(next === undefined ? {} : { next }),
      },
    ];
  });
}

export function useLimitStops(): LimitStop[] {
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  return useMemo(
    () =>
      limitStops(agents, (agent) => stateOf(agent, traces, false) === "failed", accounts, limits),
    [agents, traces, accounts, limits],
  );
}

// Re-renders once a minute, so countdowns and resets stay current.
export function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Accounts at or over 90% of a window, for the sidebar's dot.
export function useAnyAccountHigh(): boolean {
  const limits = useApp((state) => state.limits);
  const now = useMinute();
  return Object.values(limits).some((entry) => (fullest(entry, now)?.usedFraction ?? 0) >= 0.9);
}

// Carries on now: on the next account when the agent has one picked, else Automatic picks it.
export async function continueElsewhere(stop: LimitStop): Promise<void> {
  const { agent, next } = stop;
  const { record } = agent;
  if (next !== undefined && record.settings.accountId !== undefined) {
    await api.updateAgent(record.id, {
      colour: record.colour,
      purpose: record.purpose ?? "",
      settings: { ...record.settings, accountId: next.id },
    });
  }
  await api.messageAgent(record.id, "Carry on where you stopped.", agent.taskId);
}
