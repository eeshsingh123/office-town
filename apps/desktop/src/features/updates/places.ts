import type {
  DestinationRecord,
  NoticeKind,
  UpdateRoutes,
  Updates,
  UpdatesRequest,
} from "@office-town/contract";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { showToast } from "../../ui/Toast.tsx";

// Connected places in the order they were added; undefined until read.
export function usePlaces(): DestinationRecord[] | undefined {
  const places = useApp((state) => state.places);
  return places === undefined
    ? undefined
    : Object.values(places).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// The alerts a place can hear, in the core's words (D-124). No row for work stopped by a close:
// that notice is made at start, before the window can show it.
export const ALERTS: { kind: NoticeKind; label: string; short: string }[] = [
  { kind: "needs-you", label: "An agent needs you", short: "Needs you" },
  { kind: "lead-stopped", label: "A lead stops after an error", short: "Lead stops" },
  { kind: "finished", label: "A task is finished", short: "Finished" },
  { kind: "failed", label: "A task fails", short: "Fails" },
  { kind: "usage-paused", label: "Work pauses as usage runs out", short: "Usage runs out" },
  { kind: "automation", label: "An automation pauses or misses runs", short: "Automations" },
];

let writes: Promise<void> = Promise.resolve();

// Shown at once; writes go one at a time so two quick changes cannot undo each other, and a
// refused one is put back.
function saveUpdates(change: UpdatesRequest, next: Updates): void {
  const before = useApp.getState().updates;
  useApp.setState({ updates: next });
  writes = writes.then(() =>
    api.saveUpdates(change).then(
      () => undefined,
      () => {
        useApp.setState({ updates: before });
        showToast("The choice could not be saved.");
      },
    ),
  );
}

export function setHears(placeId: string, kind: NoticeKind, on: boolean): void {
  const { updates } = useApp.getState();
  const ids = (updates.routes[kind] ?? []).filter((id) => id !== placeId);
  const routes: UpdateRoutes = { [kind]: on ? [...ids, placeId] : ids };
  saveUpdates({ routes }, { ...updates, routes: { ...updates.routes, ...routes } });
}

export function setResultPlaces(resultPlaces: string[]): void {
  const { updates } = useApp.getState();
  saveUpdates({ resultPlaces }, { ...updates, resultPlaces });
}

export const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export async function sendTest(place: DestinationRecord): Promise<void> {
  try {
    await api.testDestination(place.id);
    showToast(`Sent a test to ${place.name}`);
  } catch (failure) {
    showToast(errorText(failure));
  }
}

export interface ConnectRequest {
  // Without one, the sheet starts on the list of services.
  kind?: DestinationRecord["settings"]["kind"];
  editing?: DestinationRecord;
  // Told the new place's id, so where it was opened can pick it.
  onConnected?: (placeId: string) => void;
}

// `opened` counts the times it was opened, so each opening starts fresh.
const useConnect = create<{ request: ConnectRequest | undefined; opened: number }>(() => ({
  request: undefined,
  opened: 0,
}));

// One Connect sheet for the whole app, drawn over the page it was opened from, so closing it
// returns there.
export function openConnect(request: ConnectRequest = {}): void {
  useConnect.setState((state) => ({ request, opened: state.opened + 1 }));
}

export const closeConnect = () => useConnect.setState({ request: undefined });

export const useConnectRequest = () => useConnect((state) => state.request);
export const useConnectOpened = () => useConnect((state) => state.opened);

// True once a Telegram link code has run out.
export function useExpired(expiresAt: string | undefined): boolean {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (expiresAt === undefined) return;
    const left = Date.parse(expiresAt) - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expiresAt !== undefined && Date.parse(expiresAt) <= now;
}

let computerWrites: Promise<void> = Promise.resolve();

// This computer's notices, kept in the core, which makes them (D-124); saved as `setHears` is.
export function setComputerHears(kind: NoticeKind, on: boolean): void {
  const before = useApp.getState().notifications[kind];
  useApp.setState((state) => ({ notifications: { ...state.notifications, [kind]: on } }));
  computerWrites = computerWrites.then(() =>
    api.saveNotifications({ [kind]: on }).then(
      () => undefined,
      () => {
        useApp.setState((state) => {
          const { [kind]: _, ...rest } = state.notifications;
          return { notifications: before === undefined ? rest : { ...rest, [kind]: before } };
        });
        showToast("The choice could not be saved.");
      },
    ),
  );
}

// A desktop notice now, to see how it looks.
export async function testThisComputer(): Promise<void> {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    showToast("Notifications are blocked for this app. Allow them in your computer's settings.");
    return;
  }
  new Notification("Notifications are on", {
    body: "This is how the app tells you an agent needs you.",
    tag: "test",
  });
  showToast("Sent. If nothing appeared, check your computer's notification settings.");
}
