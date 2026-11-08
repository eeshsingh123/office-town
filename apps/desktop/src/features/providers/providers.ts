import type {
  Account,
  EnvironmentSpec,
  HarnessDescription,
  HarnessStatus,
} from "@office-town/contract";
import { useEffect } from "react";
import { api } from "../../api/client.ts";
import { loadLastKnown, saveLastKnown } from "../../api/last-known.ts";
import { useApp } from "../../store/app-store.ts";
import { withStatuses } from "../../store/changes.ts";
import { offeredHarnesses } from "./offered.ts";

// Each logo is named by its harness; OpenCode has none, so it gets its first letter.
const FILES = import.meta.glob<string>("./logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
export const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([file, url]) => [file.slice("./logos/".length, -".svg".length), url]),
);
// Black marks, flipped to light in dark mode.
export const DEEP = new Set(["codex", "copilot", "cursor"]);

// The CLI's own login on this computer, which setup and Providers sign in.
export const defaultLogin = (accounts: readonly Account[], harness: string) =>
  accounts.find(
    (account) =>
      account.harness === harness &&
      account.folder === undefined &&
      account.environment.kind === "native",
  );

// Ready for an agent: installed, and signed in or needing no sign-in.
export const isReady = (status: HarnessStatus | undefined): boolean =>
  status?.installed === true && status.signedIn !== false;

const READY_NAME = "ready-harnesses";

const lastReady = loadLastKnown(READY_NAME, (stored) =>
  Array.isArray(stored) ? stored.map(String) : undefined,
);

// Saved for the next launch once every provider is checked, whether a read or the event stream
// brought them.
useApp.subscribe((state, before) => {
  const statuses = state.harnessStatuses;
  if (statuses === undefined || statuses === before.harnessStatuses) return;
  if (state.harnesses.some(({ harness }) => statuses[harness] === undefined)) return;
  const ready = Object.values(statuses).filter((status) => isReady(status));
  saveLastKnown(
    READY_NAME,
    ready.map((status) => status.harness),
  );
});

const showStatuses = (statuses: readonly HarnessStatus[]) =>
  useApp.setState((state) => ({ harnessStatuses: withStatuses(state.harnessStatuses, statuses) }));

// Each check starts every CLI, so one soon after the last is skipped.
const CHECK_GAP_MS = 5000;
let checking: Promise<void> | undefined;
let checkedAt = 0;

// `now` is the user asking again, so it waits for every CLI; any other check shows what the core
// knows and each provider's fresh status follows on the event stream (D-93).
export function checkHarnesses({ now = false } = {}): Promise<void> {
  if (checking !== undefined) return checking;
  if (!now && Date.now() - checkedAt < CHECK_GAP_MS) return Promise.resolve();
  checking = api
    .readHarnessStatus(now)
    .then(showStatuses)
    .finally(() => {
      checking = undefined;
      checkedAt = Date.now();
    });
  return checking;
}

// After an install, only that provider: about a second instead of every CLI.
export async function checkHarness(harness: string): Promise<void> {
  showStatuses([await api.readHarnessStatusIn(harness, { kind: "native" })]);
}

// Checked once when first needed. Pages about getting an app ready check again on coming back to
// the window, as after running an install command in a terminal; each check starts every CLI.
export function useHarnessStatuses({
  recheckOnFocus = false,
} = {}): Record<string, HarnessStatus> | undefined {
  const statuses = useApp((state) => state.harnessStatuses);
  useEffect(() => {
    const check = () => void checkHarnesses().catch(() => {});
    if (recheckOnFocus || useApp.getState().harnessStatuses === undefined) check();
    if (!recheckOnFocus) return;
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [recheckOnFocus]);
  return statuses;
}

// The AI apps an agent can be put on: the ones ready here, each as the last launch found it until
// this one's check reads it, and the one already chosen. Every one in WSL, where the app does not
// check installs (D-75).
export function useOfferedHarnesses(
  current: string | undefined,
  environment: EnvironmentSpec | undefined,
): { offered: HarnessDescription[]; checking: boolean } {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  if (environment?.kind === "wsl") return { offered: [...harnesses], checking: false };
  const unchecked = harnesses.some(({ harness }) => statuses?.[harness] === undefined);
  const ready =
    statuses === undefined && lastReady === undefined
      ? undefined
      : harnesses.flatMap(({ harness }) => {
          const status = statuses?.[harness];
          const readyNow = status === undefined ? lastReady?.includes(harness) : isReady(status);
          return readyNow ? [harness] : [];
        });
  return {
    offered: offeredHarnesses(harnesses, ready, current),
    checking: ready === undefined || (unchecked && lastReady === undefined),
  };
}
