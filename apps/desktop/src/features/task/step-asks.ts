import type { PlanStep } from "@office-town/contract";
import { create } from "zustand";
import { api } from "../../api/client.ts";
import { showToast } from "../../ui/Toast.tsx";

// Steps are the agent's own list, so a step the user asks for shows as asked until the agent's
// list next changes. Memory only: the message itself stays in the agent's chat.
export interface StepAsk {
  id: string;
  agentId: string;
  change: "add" | "remove";
  step: string;
  // The list as it was when asked.
  before: string;
}

export const useStepAsks = create<{ asks: StepAsk[] }>(() => ({ asks: [] }));

const listKey = (plan: readonly PlanStep[]) =>
  JSON.stringify(plan.map((step) => [step.title, step.status]));

// Still waiting: the agent's list has not changed since.
export const pendingAsks = (asks: readonly StepAsk[], agentId: string, plan: readonly PlanStep[]) =>
  asks.filter((ask) => ask.agentId === agentId && ask.before === listKey(plan));

export function askStep(
  taskId: string,
  agentId: string,
  change: StepAsk["change"],
  step: string,
  plan: readonly PlanStep[],
): void {
  const ask = { id: crypto.randomUUID(), agentId, change, step, before: listKey(plan) };
  useStepAsks.setState((state) => ({ asks: [...state.asks, ask] }));
  api.askStep(taskId, { agentId, change, step }).catch(() => {
    useStepAsks.setState((state) => ({ asks: state.asks.filter((one) => one.id !== ask.id) }));
    showToast("The request could not be sent.");
  });
}
