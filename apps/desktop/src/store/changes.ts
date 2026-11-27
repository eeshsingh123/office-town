import {
  type Change,
  type DestinationRecord,
  type HarnessStatus,
  NEW_PLACE_HEARS,
} from "@office-town/contract";
import type { AppState } from "./app-store.ts";
import { removeTask } from "./records.ts";

// Providers arrive one by one; none known yet stays undefined, as "still checking".
export const withStatuses = (
  known: AppState["harnessStatuses"],
  statuses: readonly HarnessStatus[],
): AppState["harnessStatuses"] =>
  statuses.length === 0
    ? known
    : { ...known, ...Object.fromEntries(statuses.map((status) => [status.harness, status])) };

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
  const outputs = Object.fromEntries(
    Object.entries(state.outputs).filter(([, output]) => output.taskId !== taskId),
  );
  const milestones = Object.fromEntries(
    Object.entries(state.milestones).filter(([, milestone]) => milestone.taskId !== taskId),
  );
  // The core deletes a task's posts with it.
  const feed = Object.fromEntries(
    Object.entries(state.feed).filter(([, post]) => post.taskId !== taskId),
  );
  return {
    ...state,
    ...removeTask(state, taskId),
    traces,
    delegations,
    pieces,
    checks,
    outputs,
    milestones,
    feed,
  };
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
    case "milestone": {
      const { milestone } = change;
      return { ...state, milestones: { ...state.milestones, [milestone.id]: milestone } };
    }
    case "milestone.removed": {
      const { [change.milestoneId]: _, ...milestones } = state.milestones;
      return { ...state, milestones };
    }
    case "harness":
      return { ...state, harnessStatuses: withStatuses(state.harnessStatuses, [change.status]) };
    // Heard as they come by the notifications, Home's card of stopped tasks and the automations.
    case "notice.created":
    case "queue":
    case "automation":
    case "automation.removed":
    case "run":
      return state;
    case "feed.post":
      return { ...state, feed: { ...state.feed, [change.post.id]: change.post } };
    case "feed.removed": {
      const { [change.postId]: _, ...feed } = state.feed;
      return { ...state, feed };
    }
    case "destination":
      return withPlace(state, change.destination);
    case "destination.removed":
      return withoutPlace(state, change.destinationId);
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
    case "output":
      return { ...state, outputs: { ...state.outputs, [change.output.id]: change.output } };
  }
}

// As the core does: a new place starts ticked for a few alerts, a removed one leaves every list.
function withPlace(state: AppState, place: DestinationRecord): AppState {
  if (state.places === undefined) return state;
  const isNew = state.places[place.id] === undefined;
  const routes = { ...state.updates.routes };
  if (isNew) for (const kind of NEW_PLACE_HEARS) routes[kind] = [...(routes[kind] ?? []), place.id];
  return {
    ...state,
    places: { ...state.places, [place.id]: place },
    updates: { ...state.updates, routes },
  };
}

function withoutPlace(state: AppState, placeId: string): AppState {
  if (state.places === undefined) return state;
  const { [placeId]: _, ...places } = state.places;
  const routes = Object.fromEntries(
    Object.entries(state.updates.routes).map(([kind, ids]) => [
      kind,
      ids.filter((id) => id !== placeId),
    ]),
  );
  const resultPlaces = state.updates.resultPlaces.filter((id) => id !== placeId);
  return { ...state, places, updates: { routes, resultPlaces } };
}

export function applyChanges(state: AppState, changes: readonly Change[]): AppState {
  return changes.reduce(applyChange, state);
}
