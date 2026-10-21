import type { Change } from "@office-town/contract";
import type { AppState } from "./app-store.ts";
import { removeTask } from "./records.ts";

export function withoutTask(state: AppState, taskId: string): AppState {
  const sessionIds = new Set(state.tasks[taskId]?.sessionIds);
  const traces = Object.fromEntries(
    Object.entries(state.traces).filter(([sessionId]) => !sessionIds.has(sessionId)),
  );
  const delegations = Object.fromEntries(
    Object.entries(state.delegations).filter(([, delegation]) => delegation.taskId !== taskId),
  );
  const pieces = Object.fromEntries(
    Object.entries(state.pieces).filter(([, piece]) => piece.taskId !== taskId),
  );
  const checks = Object.fromEntries(
    Object.entries(state.checks).filter(([, check]) => check.taskId !== taskId),
  );
  return { ...state, ...removeTask(state, taskId), traces, delegations, pieces, checks };
}

// A task the app does not hold yet is left out: it is read whole once one of its sessions shows up.
function applyChange(state: AppState, change: Change): AppState {
  switch (change.type) {
    case "task": {
      const entry = state.tasks[change.task.id];
      if (entry === undefined) return state;
      return {
        ...state,
        tasks: { ...state.tasks, [change.task.id]: { ...entry, task: change.task } },
      };
    }
    case "task.deleted":
      return withoutTask(state, change.taskId);
    case "agent":
      return { ...state, agents: { ...state.agents, [change.agent.id]: change.agent } };
    case "department": {
      const { department } = change;
      return { ...state, departments: { ...state.departments, [department.id]: department } };
    }
    case "department.removed": {
      const { [change.departmentId]: _, ...departments } = state.departments;
      return { ...state, departments };
    }
    case "delegation": {
      const { delegation } = change;
      return { ...state, delegations: { ...state.delegations, [delegation.id]: delegation } };
    }
    case "check":
      return { ...state, checks: { ...state.checks, [change.check.id]: change.check } };
    case "limits":
      return { ...state, limits: { ...state.limits, [change.limits.accountId]: change.limits } };
    case "piece":
      return { ...state, pieces: { ...state.pieces, [change.piece.id]: change.piece } };
    case "library":
      return { ...state, library: { ...state.library, [change.item.id]: change.item } };
    case "library.removed": {
      const { [change.itemId]: _, ...library } = state.library;
      return { ...state, library };
    }
    case "connector": {
      const { connector } = change;
      return { ...state, connectors: { ...state.connectors, [connector.id]: connector } };
    }
    case "connector.removed": {
      const { [change.connectorId]: _, ...connectors } = state.connectors;
      return { ...state, connectors };
    }
  }
}

export function applyChanges(state: AppState, changes: readonly Change[]): AppState {
  return changes.reduce(applyChange, state);
}
